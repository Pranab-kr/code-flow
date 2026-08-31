'use client';

import { useEffect, useRef } from 'react';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import { python } from '@codemirror/lang-python';
import { cpp } from '@codemirror/lang-cpp';
import { java } from '@codemirror/lang-java';
import { oneDark } from '@codemirror/theme-one-dark';
import type { Extension } from '@codemirror/state';
import type { Language } from '@/lib/ir/types';

// EditorView comes from @codemirror/view, not from @uiw/react-codemirror.
//
// Typed as Extension[] rather than ReturnType<typeof python>: the three language
// functions do not share a nominal return type, so a shared alias would reject
// two of the three under strict mode.
const EXTENSIONS: Record<Language, () => Extension[]> = {
  python: () => [python()],
  cpp: () => [cpp()],
  java: () => [java()],
};

interface Props {
  value: string;
  language: Language;
  theme: 'dark' | 'light';
  /** 1-based line to scroll into view — set when a diagram node is clicked. */
  revealLine?: number;
  onChange: (value: string) => void;
}

export function CodeEditor({ value, language, theme, revealLine, onChange }: Props) {
  const ref = useRef<ReactCodeMirrorRef>(null);

  useEffect(() => {
    if (!revealLine || !ref.current?.view) return;
    const view = ref.current.view;
    // Clamp: the diagram can lag the document by one debounce, so a stale line
    // number must not throw out of doc.line().
    const lineNo = Math.min(Math.max(1, revealLine), view.state.doc.lines);
    const line = view.state.doc.line(lineNo);
    view.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
    });
  }, [revealLine]);

  return (
    <CodeMirror
      ref={ref}
      value={value}
      height="100%"
      style={{ height: '100%', fontSize: '13px' }}
      theme={theme === 'dark' ? oneDark : 'light'}
      extensions={EXTENSIONS[language]()}
      onChange={onChange}
      basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true }}
      aria-label="Code editor"
    />
  );
}
