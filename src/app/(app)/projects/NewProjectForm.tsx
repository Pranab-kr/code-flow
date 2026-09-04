'use client';

import { useState, useTransition } from 'react';
import { createProject } from './actions';

export function NewProjectForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      // Success redirects, so control returns here only on failure.
      const result = await createProject(formData);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <form className="pj__new" action={onSubmit}>
      <label className="pj__label" htmlFor="title">
        New project
      </label>
      <div className="pj__row">
        <input
          className="pj__input"
          id="title"
          name="title"
          placeholder="Binary search"
          disabled={pending}
        />
        <select className="pj__language" name="language" defaultValue="python" disabled={pending} aria-label="Language">
          <option value="python">Python</option>
          <option value="cpp">C++</option>
          <option value="java">Java</option>
          <option value="javascript">JavaScript</option>
        </select>
        <button className="pj__create" type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create'}
        </button>
      </div>
      <p className="pj__hint">Choose the language for the starter and diagram.</p>
      {error && (
        <p className="pj__error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
