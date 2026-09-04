'use client';

import { useEffect, useRef } from 'react';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import { python } from '@codemirror/lang-python';
import { cpp } from '@codemirror/lang-cpp';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import type { Extension } from '@codemirror/state';
import type { Language } from '@/lib/ir/types';

// EditorView comes from @codemirror/view, not from @uiw/react-codemirror.
//
// Typed as Extension[] rather than ReturnType<typeof python>: the four language
// functions do not share a nominal return type, so a shared alias would reject
// three of the four under strict mode.
const EXTENSIONS: Record<Language, () => Extension[]> = {
  python: () => [python()],
  cpp: () => [cpp()],
  java: () => [java()],
  javascript: () => [javascript()],
};

interface Props {
  value: string;
  language: Language;
  theme: 'dark' | 'light';
  /** 1-based line to scroll into view — set when a diagram node is clicked. */
  revealLine?: number;
  onChange: (value: string) => void;
  onPaste?: (value: string) => void;
}

export function CodeEditor({ value, language, theme, revealLine, onChange, onPaste }: Props) {
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

  // No aria-label prop on CodeMirror: @uiw/react-codemirror forwards it onto a
  // plain div (.cm-theme) with no role, which fails axe aria-prohibited-attr.
  // The Workbench names this region already (<section aria-label="Code">).
  return (
    <CodeMirror
      ref={ref}
      value={value}
      height="100%"
      style={{ height: '100%', fontSize: '13px' }}
      theme={theme === 'dark' ? oneDark : 'light'}
      extensions={[
        ...EXTENSIONS[language](),
        EditorView.domEventHandlers({
          paste(event) {
            onPaste?.(event.clipboardData?.getData('text/plain') ?? '');
            return false;
          },
        }),
      ]}
      onChange={onChange}
      basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true }}
    />
  );
}
