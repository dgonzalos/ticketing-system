import { useState } from 'react';
import type { PendingAiActionDto } from '@ticketing-system/shared';
import { Button, Card, Input } from '../../components/ui';
import { useAuth } from '../../hooks/useAuth';
import { useRespondToPendingAction } from '../../hooks/useRespondToPendingAction';
import { useSendAssistantMessage } from '../../hooks/useSendAssistantMessage';
import { ApiError } from '../../services/http';
import styles from './AdminAssistantScreen.module.css';

interface ChatMessage {
  role: 'admin' | 'assistant';
  text: string;
}

/**
 * Route container for `/admin/assistant`. Conversation state is local-only
 * (not persisted, lost on refresh) — matching `InMemoryConversationStore`'s
 * own documented scope limit on the backend, not a bug to fix here.
 */
export function AdminAssistantScreen() {
  const { token } = useAuth();
  const sendMessage = useSendAssistantMessage({ token });
  const respond = useRespondToPendingAction({ token });

  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingAction, setPendingAction] = useState<PendingAiActionDto | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [budgetExceeded, setBudgetExceeded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const composerDisabled = pendingAction !== null || budgetExceeded || sendMessage.isPending;
  const canSend = inputValue.trim().length > 0 && !composerDisabled;

  const handleNewConversation = () => {
    setConversationId(undefined);
    setMessages([]);
    setPendingAction(null);
    setInputValue('');
    setBudgetExceeded(false);
    setError(null);
  };

  const handleSend = async () => {
    const text = inputValue.trim();
    if (!canSend) {
      return;
    }
    setMessages((prev) => [...prev, { role: 'admin', text }]);
    setInputValue('');
    setError(null);
    try {
      const result = await sendMessage.mutateAsync({ conversationId, message: text });
      setConversationId(result.conversationId);
      setMessages((prev) => [...prev, { role: 'assistant', text: result.reply }]);
      setPendingAction(result.pendingAction);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setBudgetExceeded(true);
      } else if (err instanceof ApiError && err.status === 409) {
        setError('There is already a pending action waiting on a decision — confirm or reject it first.');
      } else {
        setError((err as Error).message);
      }
    }
  };

  const handleRespond = async (decision: 'confirm' | 'reject') => {
    if (!conversationId || respond.isPending) {
      return;
    }
    setError(null);
    try {
      const result = await respond.mutateAsync({ conversationId, decision });
      setMessages((prev) => [...prev, { role: 'assistant', text: result.reply }]);
      setPendingAction(result.pendingAction);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setPendingAction(null);
        setMessages((prev) => [...prev, { role: 'assistant', text: 'That action was already resolved.' }]);
      } else if (err instanceof ApiError && err.status === 429) {
        setBudgetExceeded(true);
      } else {
        setError((err as Error).message);
      }
    }
  };

  return (
    <div className={styles.screen}>
      <Card as="section">
        <div className={styles.headerRow}>
          <h1 className={styles.heading}>AI Admin Assistant</h1>
          <Button variant="secondary" size="sm" onClick={handleNewConversation}>
            New conversation
          </Button>
        </div>

        <div className={styles.messages}>
          {messages.map((message, index) => (
            <p
              key={index}
              className={message.role === 'admin' ? styles.messageAdmin : styles.messageAssistant}
            >
              {message.text}
            </p>
          ))}
        </div>

        {pendingAction && (
          <Card className={styles.pendingCard}>
            <p className={styles.pendingSummary}>{pendingAction.summary}</p>
            <pre className={styles.commandBlock}>{JSON.stringify(pendingAction.command, null, 2)}</pre>
            <div className={styles.pendingButtons}>
              <Button onClick={() => handleRespond('confirm')} disabled={respond.isPending}>
                Confirm
              </Button>
              <Button variant="secondary" onClick={() => handleRespond('reject')} disabled={respond.isPending}>
                Reject
              </Button>
            </div>
          </Card>
        )}

        {budgetExceeded ? (
          <p className={styles.budgetWarning}>
            Daily AI budget reached — try again tomorrow, or raise ANTHROPIC_DAILY_BUDGET_USD.
          </p>
        ) : (
          <div className={styles.composer}>
            <Input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSend();
                }
              }}
              placeholder="Ask the assistant…"
              disabled={composerDisabled}
            />
            <Button onClick={handleSend} disabled={!canSend}>
              {sendMessage.isPending ? 'Sending…' : 'Send'}
            </Button>
          </div>
        )}

        {error && <p className={styles.error}>{error}</p>}
      </Card>
    </div>
  );
}
