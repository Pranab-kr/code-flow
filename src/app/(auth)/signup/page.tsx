import { AuthForm } from '../AuthForm';
import { signUp } from '../actions';

export const metadata = { title: 'Create an account · code-flow' };

export default function SignupPage() {
  return <AuthForm mode="signup" action={signUp} />;
}
