import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button, Card, Input } from '../../components/ui';
import { useAuth } from '../../hooks/useAuth';
import { useAuthRedirect } from '../../hooks/useAuthRedirect';
import { isValidEmail } from '../../utils/validation';
import styles from './SignupScreen.module.css';

const MIN_PASSWORD_LENGTH = 8;

/**
 * Route container for `/signup`. On success the account is logged in
 * immediately and returned to wherever `ProtectedRoute` sent them from, or
 * `/` if they arrived here directly. The "Log in" link forwards this
 * screen's own location state along, so that redirect target survives a
 * detour through `/login` too, not just a signup submitted directly here.
 */
export function SignupScreen() {
  const { signup } = useAuth();
  const redirectAfterAuth = useAuthRedirect();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [touched, setTouched] = useState({ email: false, password: false, passwordConfirm: false });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailError = touched.email && !isValidEmail(email) ? 'Enter a valid email address' : undefined;
  const passwordError =
    touched.password && password.length < MIN_PASSWORD_LENGTH ? `Password must be at least ${MIN_PASSWORD_LENGTH} characters` : undefined;
  const passwordConfirmError = touched.passwordConfirm && passwordConfirm !== password ? 'Passwords do not match' : undefined;

  const canSubmit =
    isValidEmail(email) &&
    password.length >= MIN_PASSWORD_LENGTH &&
    passwordConfirm === password &&
    !isSubmitting;

  const handleSubmit = async () => {
    setTouched({ email: true, password: true, passwordConfirm: true });
    if (!canSubmit) {
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      await signup(email, password, passwordConfirm);
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
        <h1 className={styles.heading}>Sign Up</h1>
        <Input
          label="Email address"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, email: true }))}
          error={emailError}
        />
        <Input
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, password: true }))}
          error={passwordError}
        />
        <Input
          label="Confirm password"
          type="password"
          value={passwordConfirm}
          onChange={(e) => setPasswordConfirm(e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, passwordConfirm: true }))}
          error={passwordConfirmError}
        />
        {error && <p className={styles.error}>{error}</p>}
        <Button fullWidth disabled={!canSubmit} onClick={handleSubmit}>
          {isSubmitting ? 'Signing up…' : 'Sign Up'}
        </Button>
        <p className={styles.switchLink}>
          Already have an account? <Link to="/login" state={location.state}>Log in</Link>
        </p>
      </Card>
    </div>
  );
}
