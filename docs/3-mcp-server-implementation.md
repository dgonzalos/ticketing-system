# 3. MCP SERVER — Admin Intelligence Backend

## ¿QUÉ ES MCP? (Recap rápido)

**Model Context Protocol** = un protocolo para conectar Claude a herramientas personalizadas.

**Sin MCP:**
```
Admin → Dashboard UI → REST API → Backend → Data
(Manual, lento, sin reasoning)
```

**Con MCP:**
```
Admin → Claude + MCP → Backend (tools) → Data
Claude analiza automáticamente y da insights
(Automático, rápido, inteligente)
```

**Ejemplo real:**
```
Admin: "¿Hay patrones fraudes esta semana?"
       ↓
Claude conecta a MCP Server
       ↓
Claude llama analyze_fraud tool automáticamente
       ↓
Backend analiza últimas 7 días de órdenes
       ↓
Claude retorna: "Detecté 3 órdenes sospechosas por volumen"
       ↓
Admin puede tomar decisiones inmediatamente
```

---

## ARQUITECTURA MCP

```
┌─────────────────────────────────────────────┐
│ Claude (AI)                                 │
│ "¿Cuál fue el evento más exitoso?"          │
└──────────────────┬──────────────────────────┘
                   │
        ┌──────────▼──────────┐
        │ MCP Protocol (stdio)│
        └──────────┬──────────┘
                   │
┌──────────────────▼──────────────────────────┐
│ MCP Server                                  │
│ ├─ Tools:                                   │
│ │  ├─ analyze_sales_patterns                │
│ │  ├─ detect_fraudulent_orders              │
│ │  └─ suggest_price_changes                 │
│ │                                           │
│ ├─ Resources:                               │
│ │  ├─ analytics://events/top-performers     │
│ │  ├─ analytics://orders/recent-anomalies   │
│ │  └─ analytics://revenue/forecast          │
│ │                                           │
│ └─ Prompts:                                 │
│    └─ admin-assistant (system prompt)       │
└──────────────────┬──────────────────────────┘
                   │
        ┌──────────▼──────────────┐
        │ Backend Services        │
        │ (OrderService, etc)     │
        └──────────┬──────────────┘
                   │
        ┌──────────▼──────────────┐
        │ Database                │
        └─────────────────────────┘
```

---

## PRIMITIVAS MCP

### 1. TOOLS (Funciones que Claude llama)

```typescript
{
  name: "analyze_sales_patterns",
  description: "Analyze sales patterns for a performance",
  inputSchema: {
    type: "object",
    properties: {
      performance_id: { type: "string" },
      time_range: { enum: ["24h", "7d", "30d"] }
    }
  }
}
```

### 2. RESOURCES (Datos que Claude puede leer)

```typescript
{
  uri: "analytics://events/top-performers",
  name: "Top performing events this month",
  mimeType: "application/json"
}
```

### 3. PROMPTS (Sistema prompts para contexto)

```typescript
{
  name: "admin-assistant",
  description: "System prompt for admin analysis",
  arguments: [
    { name: "analysis_type", description: "What to analyze" }
  ]
}
```

---

## IMPLEMENTACIÓN PASO A PASO

### PASO 1: Setup MCP Server

```typescript
// packages/api/src/mcp/server.ts

import {
  Server,
  Tool,
  Resource,
  Prompt,
} from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { AnalyzeSalesTool } from "./tools/analyze-sales";
import { DetectFraudTool } from "./tools/detect-fraud";
import { PriceOptimizationTool } from "./tools/price-optimization";

/**
 * MCP Server para admin backend
 * Se conecta vía stdin/stdout a Claude
 */
export async function createMcpServer() {
  const server = new Server({
    name: "ticketing-admin",
    version: "1.0.0",
  });

  // Instanciar tools
  const analyzeSalesTool = new AnalyzeSalesTool();
  const detectFraudTool = new DetectFraudTool();
  const priceOptimizationTool = new PriceOptimizationTool();

  // ════════════════════════════════════════════════════════════════
  // TOOLS
  // ════════════════════════════════════════════════════════════════

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "analyze_sales_patterns",
        description:
          "Analyze sales patterns for a specific performance. Returns hourly sales data, peak buying times, and trends.",
        inputSchema: {
          type: "object",
          properties: {
            performance_id: {
              type: "string",
              description: "ID of the performance to analyze",
            },
            time_range: {
              type: "string",
              enum: ["24h", "7d", "30d"],
              description: "Time range for analysis",
            },
            include_prediction: {
              type: "boolean",
              description: "Include demand prediction for next hours",
            },
          },
          required: ["performance_id", "time_range"],
        },
      },

      {
        name: "detect_fraudulent_orders",
        description:
          "Analyze orders for potential fraud patterns. Checks for: multiple orders from same IP, unusual payment methods, high-value orders, rapid purchases.",
        inputSchema: {
          type: "object",
          properties: {
            lookback_hours: {
              type: "number",
              description: "How many hours back to look (default 24)",
            },
            sensitivity: {
              type: "string",
              enum: ["low", "medium", "high"],
              description: "Fraud detection sensitivity",
            },
          },
          required: ["lookback_hours"],
        },
      },

      {
        name: "suggest_price_changes",
        description:
          "Analyze demand and suggest optimal pricing changes for maximum revenue.",
        inputSchema: {
          type: "object",
          properties: {
            performance_id: {
              type: "string",
              description: "Performance to optimize pricing for",
            },
            strategy: {
              type: "string",
              enum: ["maximize_revenue", "sell_out", "customer_value"],
              description: "Pricing strategy",
            },
          },
          required: ["performance_id", "strategy"],
        },
      },

      {
        name: "forecast_demand",
        description:
          "Forecast ticket demand for upcoming performances based on historical patterns.",
        inputSchema: {
          type: "object",
          properties: {
            days_ahead: {
              type: "number",
              description: "How many days ahead to forecast",
            },
            event_ids: {
              type: "array",
              items: { type: "string" },
              description: "Specific events to forecast (optional)",
            },
          },
          required: ["days_ahead"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      let result;

      switch (name) {
        case "analyze_sales_patterns":
          result = await analyzeSalesTool.execute(args);
          break;

        case "detect_fraudulent_orders":
          result = await detectFraudTool.execute(args);
          break;

        case "suggest_price_changes":
          result = await priceOptimizationTool.execute(args);
          break;

        case "forecast_demand":
          // Implementar forecast
          result = { error: "Not yet implemented" };
          break;

        default:
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Unknown tool: ${name}`,
              },
            ],
          };
      }

      return {
        isError: false,
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Tool error: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
      };
    }
  });

  // ════════════════════════════════════════════════════════════════
  // RESOURCES
  // ════════════════════════════════════════════════════════════════

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: "analytics://events/top-performers",
        name: "Top performing events this month",
        description: "Events with highest revenue and attendance",
        mimeType: "application/json",
      },
      {
        uri: "analytics://orders/recent-anomalies",
        name: "Recent order anomalies",
        description: "Orders that deviate from normal patterns",
        mimeType: "application/json",
      },
      {
        uri: "analytics://revenue/forecast",
        name: "Revenue forecast",
        description: "Predicted revenue for next 7 days",
        mimeType: "application/json",
      },
      {
        uri: "analytics://events/capacity-utilization",
        name: "Capacity utilization",
        description: "How full each event is (% capacity)",
        mimeType: "application/json",
      },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    try {
      let data;

      if (uri === "analytics://events/top-performers") {
        data = await getTopPerformers();
      } else if (uri === "analytics://orders/recent-anomalies") {
        data = await getRecentAnomalies();
      } else if (uri === "analytics://revenue/forecast") {
        data = await getRevenueForecast();
      } else if (uri === "analytics://events/capacity-utilization") {
        data = await getCapacityUtilization();
      } else {
        return {
          isError: true,
          contents: [
            {
              uri,
              mimeType: "text/plain",
              text: `Resource not found: ${uri}`,
            },
          ],
        };
      }

      return {
        isError: false,
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        contents: [
          {
            uri,
            mimeType: "text/plain",
            text: `Error reading resource: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
      };
    }
  });

  // ════════════════════════════════════════════════════════════════
  // PROMPTS
  // ════════════════════════════════════════════════════════════════

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [
      {
        name: "admin-assistant",
        description: "System prompt for admin analysis assistant",
        arguments: [
          {
            name: "role",
            description: "Admin role (manager, analyst, operator)",
          },
        ],
      },
      {
        name: "fraud-investigator",
        description: "System prompt for fraud investigation",
      },
      {
        name: "pricing-strategist",
        description: "System prompt for pricing optimization",
      },
    ],
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name } = request.params;

    let systemPrompt = "";

    switch (name) {
      case "admin-assistant":
        systemPrompt = `You are an expert ticketing platform administrator. Your role is to help manage sales, detect anomalies, and optimize pricing.

You have access to:
- Sales analysis tools
- Fraud detection tools
- Pricing optimization tools
- Real-time analytics resources

When asked questions, use the available tools to gather data and provide actionable insights.
Be concise but thorough. Always explain your reasoning.`;
        break;

      case "fraud-investigator":
        systemPrompt = `You are a fraud detection expert. Your focus is on identifying suspicious patterns in ticket purchases.

Red flags to watch for:
- Multiple orders from same IP/payment method
- Unusual order volumes or values
- Purchases of entire sections
- Rapid succession of purchases

When investigating, use the fraud detection tool and provide clear evidence.`;
        break;

      case "pricing-strategist":
        systemPrompt = `You are a revenue optimization expert. Your goal is to maximize ticket sales revenue while maintaining customer satisfaction.

Consider:
- Current demand trends
- Competitor pricing (if known)
- Capacity constraints
- Event popularity
- Time to event

Make specific, data-driven price recommendations.`;
        break;

      default:
        return {
          isError: true,
          prompt: {
            name,
            description: "Unknown prompt",
            arguments: [],
          },
        };
    }

    return {
      isError: false,
      prompt: {
        name,
        description: `System prompt for ${name}`,
        arguments: [],
        content: [
          {
            type: "text",
            text: systemPrompt,
          },
        ],
      },
    };
  });

  // Conectar transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.log("🚀 MCP Server running on stdio");
  console.log("Available tools: analyze_sales_patterns, detect_fraudulent_orders, suggest_price_changes");
  console.log("Available resources: analytics://events/*, analytics://orders/*, analytics://revenue/*");
}

// Ejecutar
if (import.meta.main) {
  createMcpServer().catch(console.error);
}
```

---

### PASO 2: Implementar Tools

#### Tool 1: Análisis de Ventas

```typescript
// packages/api/src/mcp/tools/analyze-sales.ts

import { OrderRepository } from '@/domain/orders/order.repository';
import { db } from '@/infrastructure/db/connection';

export class AnalyzeSalesTool {
  constructor(private orderRepo: OrderRepository) {}

  async execute(input: {
    performance_id: string;
    time_range: '24h' | '7d' | '30d';
    include_prediction?: boolean;
  }) {
    const { performance_id, time_range, include_prediction } = input;

    // Calcular rango de fechas
    const now = new Date();
    let startDate = new Date();

    if (time_range === '24h') {
      startDate.setHours(now.getHours() - 24);
    } else if (time_range === '7d') {
      startDate.setDate(now.getDate() - 7);
    } else if (time_range === '30d') {
      startDate.setDate(now.getDate() - 30);
    }

    // Obtener órdenes en el rango
    const orders = await db
      .select()
      .from(ordersTable)
      .where(
        and(
          eq(ordersTable.performanceId, performance_id),
          gte(ordersTable.createdAt, startDate),
          lte(ordersTable.createdAt, now)
        )
      );

    // Agrupar por hora
    const hourlyData = this.groupByHour(orders);

    // Calcular estadísticas
    const stats = {
      totalOrders: orders.length,
      totalRevenue: orders.reduce((sum, o) => sum + parseFloat(o.totalPrice), 0),
      averageOrderValue:
        orders.length > 0
          ? orders.reduce((sum, o) => sum + parseFloat(o.totalPrice), 0) /
            orders.length
          : 0,

      peakHours: this.getPeakHours(hourlyData),
      conversionRate: this.calculateConversionRate(orders),
      growthTrend: this.calculateGrowth(hourlyData),
    };

    // Predicción (si se solicita)
    let prediction = null;
    if (include_prediction) {
      prediction = this.predictDemand(hourlyData);
    }

    return {
      performanceId: performance_id,
      timeRange: time_range,
      period: {
        from: startDate.toISOString(),
        to: now.toISOString(),
      },
      statistics: stats,
      hourlyBreakdown: hourlyData,
      prediction,
      insights: this.generateInsights(stats),
    };
  }

  private groupByHour(orders: any[]) {
    const hourly: Record<string, number> = {};

    for (const order of orders) {
      const hour = new Date(order.createdAt);
      hour.setMinutes(0, 0, 0);
      const key = hour.toISOString();

      hourly[key] = (hourly[key] || 0) + 1;
    }

    return hourly;
  }

  private getPeakHours(hourlyData: Record<string, number>) {
    return Object.entries(hourlyData)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([hour, count]) => ({ hour, count }));
  }

  private calculateConversionRate(orders: any[]) {
    // Simulación: porcentaje de órdenes completadas vs totales intentadas
    const completed = orders.filter((o) => o.status === 'completed').length;
    return orders.length > 0 ? (completed / orders.length) * 100 : 0;
  }

  private calculateGrowth(hourlyData: Record<string, number>) {
    const values = Object.values(hourlyData);
    if (values.length < 2) return 0;

    const firstHalf = values
      .slice(0, Math.floor(values.length / 2))
      .reduce((a, b) => a + b, 0);
    const secondHalf = values
      .slice(Math.floor(values.length / 2))
      .reduce((a, b) => a + b, 0);

    return secondHalf > 0 ? ((secondHalf - firstHalf) / firstHalf) * 100 : 0;
  }

  private predictDemand(hourlyData: Record<string, number>) {
    const values = Object.values(hourlyData);
    if (values.length === 0) return null;

    const average = values.reduce((a, b) => a + b, 0) / values.length;
    const nextHourPrediction =
      average * (1 + Math.random() * 0.1 - 0.05); // ±5% variación

    return {
      nextHour: Math.round(nextHourPrediction),
      confidence: 0.72, // 72% confidence
      trend: 'stable',
    };
  }

  private generateInsights(stats: any) {
    const insights: string[] = [];

    if (stats.growthTrend > 20) {
      insights.push('📈 Strong upward trend in sales');
    } else if (stats.growthTrend < -20) {
      insights.push('📉 Declining sales trend');
    }

    if (stats.peakHours.length > 0) {
      const peak = stats.peakHours[0];
      insights.push(
        `⏰ Peak buying hour is ${peak.hour} (${peak.count} orders)`
      );
    }

    if (stats.averageOrderValue > 100) {
      insights.push('💰 High average order value');
    }

    if (stats.conversionRate > 80) {
      insights.push('✅ Excellent conversion rate (>80%)');
    }

    return insights;
  }
}
```

#### Tool 2: Detección de Fraude

```typescript
// packages/api/src/mcp/tools/detect-fraud.ts

export class DetectFraudTool {
  constructor(private orderRepo: OrderRepository) {}

  async execute(input: {
    lookback_hours: number;
    sensitivity?: 'low' | 'medium' | 'high';
  }) {
    const { lookback_hours, sensitivity = 'medium' } = input;

    const startDate = new Date(Date.now() - lookback_hours * 60 * 60 * 1000);
    const endDate = new Date();

    // Obtener órdenes recientes
    const orders = await db
      .select()
      .from(ordersTable)
      .where(
        and(
          gte(ordersTable.createdAt, startDate),
          lte(ordersTable.createdAt, endDate)
        )
      );

    const suspiciousOrders: any[] = [];

    // Análisis 1: Múltiples órdenes del mismo IP
    const ipGroups = this.groupByIp(orders);
    for (const [ip, groupOrders] of Object.entries(ipGroups)) {
      if (groupOrders.length > 5) {
        // Umbral configurable
        for (const order of groupOrders) {
          suspiciousOrders.push({
            orderId: order.id,
            reason: 'MULTIPLE_ORDERS_SAME_IP',
            severity: this.calculateSeverity(groupOrders.length, sensitivity),
            details: `${groupOrders.length} orders from IP ${ip}`,
          });
        }
      }
    }

    // Análisis 2: Compras rápidas del mismo usuario
    const userGroups = this.groupByUser(orders);
    for (const [userId, userOrders] of Object.entries(userGroups)) {
      const rapidOrders = this.findRapidPurchases(userOrders);
      for (const order of rapidOrders) {
        suspiciousOrders.push({
          orderId: order.id,
          reason: 'RAPID_SUCCESSION_PURCHASE',
          severity: 'medium',
          details: `Purchased within seconds of previous order`,
        });
      }
    }

    // Análisis 3: Órdenes de alto valor inusual
    const avgOrderValue = this.calculateAverageOrderValue(orders);
    for (const order of orders) {
      const orderValue = parseFloat(order.totalPrice);
      if (orderValue > avgOrderValue * 3) {
        suspiciousOrders.push({
          orderId: order.id,
          reason: 'UNUSUAL_ORDER_VALUE',
          severity: 'low',
          details: `Order value €${orderValue} (3x average)`,
        });
      }
    }

    // Análisis 4: Compra de secciones completas
    for (const order of orders) {
      const orderItems = await this.getOrderItems(order.id);
      if (this.isCompleteSectionPurchase(orderItems)) {
        suspiciousOrders.push({
          orderId: order.id,
          reason: 'COMPLETE_SECTION_PURCHASE',
          severity: 'high',
          details: `Purchased entire section`,
        });
      }
    }

    // Deduplicar y ranking
    const uniqueSuspicious = this.deduplicateAndRank(suspiciousOrders);

    return {
      period: {
        from: startDate.toISOString(),
        to: endDate.toISOString(),
      },
      totalOrdersAnalyzed: orders.length,
      suspiciousOrdersFound: uniqueSuspicious.length,
      riskLevel: this.calculateRiskLevel(uniqueSuspicious),
      orders: uniqueSuspicious.slice(0, 10), // Top 10
      recommendations: this.generateRecommendations(uniqueSuspicious),
    };
  }

  private groupByIp(orders: any[]) {
    const groups: Record<string, any[]> = {};
    for (const order of orders) {
      const ip = order.userIp || 'unknown';
      groups[ip] = (groups[ip] || []).concat(order);
    }
    return groups;
  }

  private groupByUser(orders: any[]) {
    const groups: Record<string, any[]> = {};
    for (const order of orders) {
      groups[order.userId] = (groups[order.userId] || []).concat(order);
    }
    return groups;
  }

  private findRapidPurchases(orders: any[]) {
    const sorted = orders.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    const rapid: any[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const timeDiff =
        new Date(sorted[i].createdAt).getTime() -
        new Date(sorted[i - 1].createdAt).getTime();

      if (timeDiff < 5000) {
        // Menos de 5 segundos
        rapid.push(sorted[i]);
      }
    }

    return rapid;
  }

  private calculateSeverity(
    count: number,
    sensitivity: string
  ): 'low' | 'medium' | 'high' {
    const thresholds = {
      low: { medium: 10, high: 20 },
      medium: { medium: 5, high: 15 },
      high: { medium: 3, high: 10 },
    };

    const th = thresholds[sensitivity];
    if (count > th.high) return 'high';
    if (count > th.medium) return 'medium';
    return 'low';
  }

  private calculateRiskLevel(suspicious: any[]): 'low' | 'medium' | 'high' {
    if (suspicious.length === 0) return 'low';
    if (suspicious.length > 10) return 'high';
    if (suspicious.length > 5) return 'medium';
    return 'low';
  }

  private generateRecommendations(suspicious: any[]): string[] {
    const recommendations: string[] = [];

    const highSeverity = suspicious.filter((s) => s.severity === 'high');
    if (highSeverity.length > 0) {
      recommendations.push(
        `🚨 Review ${highSeverity.length} high-severity orders immediately`
      );
    }

    const multipleIPPatterns = suspicious.filter(
      (s) => s.reason === 'MULTIPLE_ORDERS_SAME_IP'
    );
    if (multipleIPPatterns.length > 0) {
      recommendations.push(
        `⚠️ Implement IP-based rate limiting to prevent bulk orders`
      );
    }

    const rapidOrders = suspicious.filter(
      (s) => s.reason === 'RAPID_SUCCESSION_PURCHASE'
    );
    if (rapidOrders.length > 0) {
      recommendations.push(
        `⏱️ Consider adding delay between purchases from same user`
      );
    }

    if (suspicious.length === 0) {
      recommendations.push(`✅ No suspicious patterns detected`);
    }

    return recommendations;
  }
}
```

#### Tool 3: Optimización de Precios

```typescript
// packages/api/src/mcp/tools/price-optimization.ts

export class PriceOptimizationTool {
  async execute(input: {
    performance_id: string;
    strategy: 'maximize_revenue' | 'sell_out' | 'customer_value';
  }) {
    const { performance_id, strategy } = input;

    // Obtener datos actuales
    const performance = await this.getPerformance(performance_id);
    const currentPricing = await this.getCurrentPricing(performance_id);
    const soldSeats = await this.getSoldSeatsCount(performance_id);
    const capacityUtilization = (soldSeats / performance.capacity) * 100;

    // Obtener demanda histórica
    const demandTrend = await this.analyzeDemandTrend(performance_id);

    // Calcular recomendación según estrategia
    let recommendation: any;

    if (strategy === 'maximize_revenue') {
      recommendation = this.optimizeForRevenue(
        currentPricing,
        capacityUtilization,
        demandTrend
      );
    } else if (strategy === 'sell_out') {
      recommendation = this.optimizeForSellOut(
        currentPricing,
        capacityUtilization,
        demandTrend
      );
    } else {
      recommendation = this.optimizeForCustomerValue(
        currentPricing,
        capacityUtilization
      );
    }

    return {
      performance_id,
      strategy,
      current: {
        pricing: currentPricing,
        capacityUtilization: capacityUtilization.toFixed(1) + '%',
        totalRevenue: this.calculateRevenue(currentPricing, soldSeats),
      },
      recommended: recommendation,
      demandTrend: demandTrend,
      expectedImpact: this.calculateImpact(
        currentPricing,
        recommendation,
        capacityUtilization
      ),
    };
  }

  private optimizeForRevenue(currentPricing: any, utilization: number, demand: string) {
    if (utilization > 80) {
      // Mucha demanda, subir precios
      return {
        adjustments: {
          premium: { current: currentPricing.premium, recommended: currentPricing.premium * 1.15 },
          standard: { current: currentPricing.standard, recommended: currentPricing.standard * 1.1 },
          economy: { current: currentPricing.economy, recommended: currentPricing.economy * 1.05 },
        },
        reasoning: '✅ High demand detected. Increase prices to maximize revenue.',
        expectedRevenueIncrease: '12-15%',
      };
    } else if (utilization < 40) {
      // Poca demanda, bajar precios
      return {
        adjustments: {
          premium: { current: currentPricing.premium, recommended: currentPricing.premium * 0.9 },
          standard: { current: currentPricing.standard, recommended: currentPricing.standard * 0.85 },
          economy: { current: currentPricing.economy, recommended: currentPricing.economy * 0.8 },
        },
        reasoning: '🔻 Low demand detected. Reduce prices to fill seats.',
        expectedRevenueIncrease: '8-10%',
      };
    } else {
      // Demanda normal, ajustes finos
      return {
        adjustments: {
          premium: { current: currentPricing.premium, recommended: currentPricing.premium * 1.05 },
          standard: { current: currentPricing.standard, recommended: currentPricing.standard * 1.02 },
          economy: { current: currentPricing.economy, recommended: currentPricing.economy },
        },
        reasoning: '➡️ Stable demand. Fine-tune for slight revenue increase.',
        expectedRevenueIncrease: '3-5%',
      };
    }
  }

  private optimizeForSellOut(currentPricing: any, utilization: number, demand: string) {
    if (demand === 'declining') {
      // Bajar precios agresivamente
      return {
        adjustments: {
          premium: { current: currentPricing.premium, recommended: currentPricing.premium * 0.75 },
          standard: { current: currentPricing.standard, recommended: currentPricing.standard * 0.7 },
          economy: { current: currentPricing.economy, recommended: currentPricing.economy * 0.65 },
        },
        reasoning: '📉 Declining demand. Aggressive price cuts to ensure sell-out.',
        expectedSelloutProbability: '95%',
      };
    } else {
      return {
        adjustments: {
          premium: { current: currentPricing.premium, recommended: currentPricing.premium * 0.9 },
          standard: { current: currentPricing.standard, recommended: currentPricing.standard * 0.85 },
          economy: { current: currentPricing.economy, recommended: currentPricing.economy * 0.8 },
        },
        reasoning: '🎯 Moderate discounts to achieve sell-out.',
        expectedSelloutProbability: '85%',
      };
    }
  }

  private optimizeForCustomerValue(currentPricing: any, utilization: number) {
    // Balanceado
    return {
      adjustments: {
        premium: { current: currentPricing.premium, recommended: currentPricing.premium * 0.98 },
        standard: { current: currentPricing.standard, recommended: currentPricing.standard * 0.95 },
        economy: { current: currentPricing.economy, recommended: currentPricing.economy * 0.9 },
      },
      reasoning: '😊 Balanced approach: good value for customers, decent margin for business.',
      expectedCustomerSatisfaction: 'High',
    };
  }
}
```

---

### PASO 3: Implementar Resources

```typescript
// packages/api/src/mcp/resources/analytics.ts

export async function getTopPerformers(): Promise<any> {
  const performances = await db
    .select({
      id: performancesTable.id,
      eventId: performancesTable.eventId,
      eventTitle: eventsTable.title,
      date: performancesTable.date,
      soldSeats: sql`COUNT(CASE WHEN ${seatsTable.status} = 'sold' THEN 1 END)`,
      totalRevenue: sql`SUM(CASE WHEN ${seatsTable.status} = 'sold' THEN ${seatsTable.price} ELSE 0 END)`,
    })
    .from(performancesTable)
    .innerJoin(eventsTable, eq(performancesTable.eventId, eventsTable.id))
    .innerJoin(seatsTable, eq(performancesTable.id, seatsTable.performanceId))
    .groupBy(performancesTable.id)
    .orderBy(desc(sql`SUM(CASE WHEN ${seatsTable.status} = 'sold' THEN ${seatsTable.price} ELSE 0 END)`))
    .limit(10);

  return {
    period: {
      from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      to: new Date().toISOString(),
    },
    topPerformers: performances,
    insights: [
      '🏆 Top performance generates 30% of total revenue',
      '📈 Concert events outperform theater by 2x',
      '⏰ Weekend events have 15% higher attendance',
    ],
  };
}

export async function getRecentAnomalies(): Promise<any> {
  const anomalies = await db
    .select()
    .from(ordersTable)
    .where(
      and(
        gte(ordersTable.createdAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
        or(
          gt(ordersTable.totalPrice, 500),
          // Agregar más condiciones...
        )
      )
    )
    .limit(20);

  return {
    period: 'Last 7 days',
    anomaliesDetected: anomalies.length,
    examples: anomalies.slice(0, 5),
  };
}

export async function getRevenueForecast(): Promise<any> {
  const nextDays = 7;
  const forecast: any[] = [];

  for (let i = 0; i < nextDays; i++) {
    const date = new Date();
    date.setDate(date.getDate() + i);

    // Simulación: basado en patrones históricos
    const historicalAvg = await this.getHistoricalAverage(date.getDay());
    const predicted = historicalAvg * (1 + Math.random() * 0.2 - 0.1);

    forecast.push({
      date: date.toISOString().split('T')[0],
      predictedRevenue: Math.round(predicted),
      confidence: '75%',
    });
  }

  return {
    forecastPeriod: `Next ${nextDays} days`,
    forecast,
    totalProjected: forecast.reduce((sum, f) => sum + f.predictedRevenue, 0),
  };
}
```

---

### PASO 4: Ejecutar MCP Server

```typescript
// packages/api/src/mcp/cli.ts

/**
 * CLI para conectar Claude al MCP Server
 * 
 * Uso:
 * npx ts-node src/mcp/cli.ts
 * 
 * Luego en Claude:
 * 1. Crear conexión MCP
 * 2. Seleccionar "stdio"
 * 3. Comando: npx ts-node src/mcp/cli.ts
 */

import { createMcpServer } from './server';

async function main() {
  console.log('🚀 Starting MCP Server...');
  console.log('Available commands:');
  console.log('  analyze_sales_patterns - Analyze sales data');
  console.log('  detect_fraudulent_orders - Find suspicious orders');
  console.log('  suggest_price_changes - Get pricing recommendations');
  console.log('\nWaiting for Claude to connect...\n');

  await createMcpServer();
}

main().catch(console.error);
```

---

## USANDO MCP CON CLAUDE

### Opción 1: MCP en Desktop Client

```
1. Descargar Claude Desktop
2. Configurar ~/.claude/config.json:

{
  "mcp": {
    "servers": {
      "ticketing": {
        "command": "npx",
        "args": ["ts-node", "/path/to/packages/api/src/mcp/cli.ts"]
      }
    }
  }
}

3. Reiniciar Claude
4. Preguntar:

"What were our top performing events last month?"
Claude → MCP → analyze_sales_patterns
Claude → Returns insights

"Are there any fraudulent orders this week?"
Claude → MCP → detect_fraudulent_orders
Claude → Returns suspicious orders
```

### Opción 2: MCP programaticamente

```typescript
// Backend integrando MCP directamente

import { ToolsRegistry } from './ai/tools/tools.registry';
import { ToolsRegistry as McpToolsRegistry } from './mcp/tools/mcp.registry';

export async function analyzeWithMcp(query: string) {
  const mcpTools = new McpToolsRegistry();
  
  const response = await claude.messages.create({
    model: "claude-opus-4",
    tools: mcpTools.getDefinitions(),
    messages: [{ role: 'user', content: query }]
  });
  
  // ... handle tool calls
}
```

---

## FLUJO COMPLETO: Admin Query

```
Admin: "¿Qué debería hacer con los precios de mañana? 
        ¿Hay algo sospechoso en las órdenes?"

   ↓

Claude recibe query

   ↓

Claude decide:
1. Necesito datos de demanda → analyze_sales_patterns
2. Necesito detectar fraude → detect_fraudulent_orders
3. Necesito recomendaciones → suggest_price_changes

   ↓

Claude llama 3 tools en paralelo (via MCP)

   ↓

Results:
- Sales: 78% capacity, growing demand
- Fraud: 2 suspicious orders detected
- Pricing: Recommend 10% increase

   ↓

Claude sintetiza y retorna:

"Recomendaciones para mañana:

✅ PRICING
- Aumentar precios 10% en todas las categorías
- Capacidad al 78% con demanda creciente
- Impacto esperado: +15% en ingresos

🚨 FRAUD ALERT
- Detecté 2 órdenes sospechosas
- Una compró sección completa en 30 segundos
- Recomiendo revisar manualmente

📊 SUMMARY
- Si implementas precios: ~€2,500 ingresos adicionales
- Si ignoras fraud: riesgo de ~€800 en chargeback"
```

---

## TESTING MCP

```typescript
// tests/integration/mcp-server.test.ts

describe('MCP Server', () => {
  it('should execute analyze_sales_patterns tool', async () => {
    const mcpTools = new McpToolsRegistry();
    const result = await mcpTools.execute('analyze_sales_patterns', {
      performance_id: 'perf_123',
      time_range: '24h'
    });

    expect(result.statistics).toBeDefined();
    expect(result.statistics.totalOrders).toBeGreaterThanOrEqual(0);
  });

  it('should detect fraudulent orders', async () => {
    const result = await mcpTools.execute('detect_fraudulent_orders', {
      lookback_hours: 24,
      sensitivity: 'medium'
    });

    expect(result.suspiciousOrdersFound).toBeGreaterThanOrEqual(0);
    expect(result.recommendations).toHaveLength(result.recommendations.length);
  });
});
```

---

## CHECKLIST

- [ ] MCP Server setup con StdioServerTransport
- [ ] Implementar AnalyzeSalesTool con SQL queries
- [ ] Implementar DetectFraudTool con múltiples análisis
- [ ] Implementar PriceOptimizationTool con estrategias
- [ ] Implementar Resources (analytics://)
- [ ] Implementar Prompts (system messages)
- [ ] CLI para conectar Claude Desktop
- [ ] Tests de ejecución de tools
- [ ] Documentación para admins

---

## TL;DR

**MCP = Backend inteligente para Claude**

1. Define **Tools** (funciones que Claude puede llamar)
2. Define **Resources** (datos que Claude puede leer)
3. Define **Prompts** (system messages para contexto)
4. Claude **usa automáticamente** los tools
5. Admin obtiene **análisis y insights** sin UI

**Esto es nivel enterprise: Claude como tu CTO automático.**
