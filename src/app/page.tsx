import Link from 'next/link';
import { Nav } from '@/components/marketing/Nav';
import { HeroCanvas } from '@/components/marketing/HeroCanvas';
import { Footer } from '@/components/marketing/Footer';
import '@/components/marketing/marketing.css';

/**
 * Marketing surface (Plan 6 Task 1). Hallmark Map/Diagram macrostructure —
 * the hero is the real product rendering prebaked output, not a screenshot.
 *
 * Deviation from the plan's file list: the plan names
 * `src/app/(marketing)/page.tsx`, but a `(marketing)` group page and this
 * `src/app/page.tsx` would both own `/`. The marketing page lives here
 * instead; no route is duplicated.
 */

export const metadata = {
  title: 'code-flow · Read the shape of your code',
  description:
    'Paste a solution and read its branches and loops as a diagram derived from the source.',
};

export default function Home() {
  return (
    <div className="mpage">
      <Nav />
      <main>
        <div className="hero">
          <p className="hero__eyebrow">code-flow</p>
          <h1 className="hero__title">Your code, drawn as it runs.</h1>
          <p className="hero__lede">
            Paste a solution and read its branches and loops as a diagram. The diagram is
            derived from the source, so it cannot drift out of step with it.
          </p>
          <div className="hero__actions">
            <Link className="hero__cta" href="/demo">
              Open the live demo
            </Link>
          </div>
          <HeroCanvas />
          <ul className="hero__legend" aria-label="How to read the diagram">
            <li>
              <b>Diamond</b> — a branch
            </li>
            <li>
              <b>Doubled rule</b> — a loop
            </li>
            <li>
              <b>Filled cap</b> — a return
            </li>
          </ul>
        </div>

        <section className="msection" id="how" aria-labelledby="how-h">
          <p className="msection__kicker">What it does</p>
          <h2 className="msection__head" id="how-h">
            Three specifics, not promises
          </h2>
          <ul className="mfacts">
            <li>
              <h3>Derived, not drawn</h3>
              <p>
                Every parse rebuilds the diagram from source. There is no hand editing
                step to go stale.
              </p>
            </li>
            <li>
              <h3>Click a node, land on its line</h3>
              <p>
                Each block knows its source lines. Selecting the diagram reveals the
                code behind it.
              </p>
            </li>
            <li>
              <h3>Arrange it your way</h3>
              <p>
                Drag blocks into the layout that reads best. Positions are saved with
                the project.
              </p>
            </li>
          </ul>
        </section>

        <section className="msection" id="languages" aria-labelledby="lang-h">
          <p className="msection__kicker">Languages</p>
          <h2 className="msection__head" id="lang-h">
            Python, C++, and Java
          </h2>
          <p className="msection__body">
            Paste and the picker detects the language; override it any time. The same
            algorithm diagrams the same way in all three.
          </p>
          <ul className="mlangs" aria-label="Supported languages">
            <li>Python</li>
            <li>C++</li>
            <li>Java</li>
          </ul>
        </section>

        <section className="msection" id="scope" aria-labelledby="scope-h">
          <p className="msection__kicker">Honest scope</p>
          <h2 className="msection__head" id="scope-h">
            Structure now, execution next
          </h2>
          <p className="msection__body">
            This release shows structure: branches, loops, calls, and dead code. Running
            code and tracing execution come next. Export a diagram as PNG, JPEG, or SVG
            whenever it reads right.
          </p>
        </section>
      </main>
      <Footer />
    </div>
  );
}
