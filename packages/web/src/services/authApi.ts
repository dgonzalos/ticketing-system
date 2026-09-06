import type { AuthResponseDto, LoginRequestDto, SignupRequestDto } from '@ticketing-system/shared';
import { API_BASE, parseErrorMessage } from './http';

/** Registers a new account and logs it in immediately. */
export async function signup(input: SignupRequestDto): Promise<AuthResponseDto> {
  const response = await fetch(`${API_BASE}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Failed to sign up'));
  }
  return response.json();
}

/** Verifies email + password and logs in on success. */
export async function login(input: LoginRequestDto): Promise<AuthResponseDto> {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Failed to log in'));
  }
  return response.json();
}
