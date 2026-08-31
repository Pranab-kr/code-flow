import { AuthForm } from '../AuthForm';
import { signIn } from '../actions';

export const metadata = { title: 'Sign in · code-flow' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <AuthForm mode="signin" action={signIn} next={next} />;
}
