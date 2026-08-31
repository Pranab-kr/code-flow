import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { signOut } from '../../(auth)/actions';
import { NewProjectForm } from './NewProjectForm';
import './projects.css';

export const metadata = { title: 'Your projects · code-flow' };

export default async function ProjectsPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // RLS scopes this to the signed-in user; no user_id filter needed.
  const { data: projects } = await supabase
    .from('projects')
    .select('id, title, language, updated_at')
    .order('updated_at', { ascending: false });

  return (
    <main className="pj">
      <header className="pj__bar">
        <span className="pj__brand">code-flow</span>
        <span className="pj__who">{user.email}</span>
        <ThemeToggle />
        <form action={signOut}>
          <button className="pj__signout" type="submit">
            Sign out
          </button>
        </form>
      </header>

      <div className="pj__body">
        <h1 className="pj__heading">Your projects</h1>

        <NewProjectForm />

        {projects && projects.length > 0 ? (
          <ul className="pj__list">
            {projects.map((p) => (
              <li key={p.id} className="pj__item">
                <Link className="pj__link" href={`/projects/${p.id}`}>
                  <span className="pj__title">{p.title}</span>
                  <span className="pj__meta">
                    {p.language} · {new Date(p.updated_at).toLocaleDateString()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          // An empty state should say what to do next, not just report emptiness.
          <p className="pj__empty">
            Nothing here yet. Name a project above and you will get a binary search to
            read — replace it with your own code whenever you like.
          </p>
        )}
      </div>
    </main>
  );
}
