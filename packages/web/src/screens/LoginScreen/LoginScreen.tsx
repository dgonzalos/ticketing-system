import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button, Card, Input } from '../../components/ui';
import { useAuth } from '../../hooks/useAuth';
import { useAuthRedirect } from '../../hooks/useAuthRedirect';
import { isValidEmail } from '../../utils/validation';
import styles from './LoginScreen.module.css';

/**
 * Route container for `/login`. On success, returns the user to wherever
 * `ProtectedRoute` sent them from, or `/`. The "Sign up" link forwards this
 * screen's own location state along, so that redirect target survives a
 * detour through `/signup` too, not just a login submitted directly here.
 */
export function LoginScreen() {
  const { login } = useAuth();
  const redirectAfterAuth = useAuthRedirect();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touchedEmail, setTouchedEmail] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailError = touchedEmail && !isValidEmail(email) ? 'Enter a valid email address' : undefined;
  const canSubmit = isValidEmail(email) && password.length > 0 && !isSubmitting;

  const handleSubmit = async () => {
    setTouchedEmail(true);
    if (!canSubmit) {
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      await login(email, password);
      redirectAfterAuth();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={styles.screen}>
      <Card as="section">
        <h1 className={styles.heading}>Log In</h1>
        <Input
          label="Email address"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => setTouchedEmail(true)}
          error={emailError}
        />
        <Input
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className={styles.error}>{error}</p>}
        <Button fullWidth disabled={!canSubmit} onClick={handleSubmit}>
          {isSubmitting ? 'Logging in…' : 'Log In'}
        </Button>
        <p className={styles.switchLink}>
          Don't have an account? <Link to="/signup" state={location.state}>Sign up</Link>
        </p>
      </Card>
    </div>
  );
}
