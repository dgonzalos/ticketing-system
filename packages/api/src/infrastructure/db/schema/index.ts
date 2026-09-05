/**
 * Centralized schema exports for all database tables.
 * 
 * New bounded contexts (orders, events, users, etc.) should add
 * their schema file and re-export here, keeping client.ts stable.
 */

export * from './events.js';
export * from './performances.js';
export * from './seats.js';
export * from './orders.js';