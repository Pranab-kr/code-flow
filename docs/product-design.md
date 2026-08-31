# code-flow — Product Design

What this product is trying to be, who it serves, and the design principles that follow.
For architecture see the spec; for what to build next see `PROGRESS.md`.

---

## The problem

A learner reading their own recursive solution cannot see it run. They trace it on paper,
lose their place in the third recursive call, and conclude they understand it because the
tests pass. Interview prep makes this worse: the pressure is to memorize the shape of a
solution rather than see why it terminates.

Existing tools each solve half of it. Debuggers show one moment at a time and demand you
already know where to look. Whiteboard tools draw anything but know nothing about your code.
Visualizers cover a fixed catalogue of textbook algorithms, not the code you actually wrote.

## The product

Paste your code. See its real structure. Ask about it. Take it with you.

code-flow derives a control-flow diagram from **your** source — not a canned animation of
someone else's binary search — and keeps the two in sync by making the diagram a view of the
code rather than a second copy of it.

## Primary audience

**Learners and interview-prep candidates.** This is the choice that settles most arguments:

| Because the audience is learners… | …the design does this |
|---|---|
| They don't know what they're looking for | Explanatory empty states, not blank canvases |
| They're reading, not authoring at speed | Readable basic blocks over exhaustive statement graphs |
| They need to trust it | The diagram is derived, so it cannot lie about the code |
| Recursion is the thing that defeats them | The recursion tree is P3's hero feature |
| They're on a laptop at 1am | Dark by default |
| They study from notes and slides | Export is a first-class feature, not an afterthought |

Competitive programmers and educators are welcome, but where their needs conflict with a
learner's — density over explanation, presentation polish over debugging depth — the learner wins.

## What makes it different

1. **It's about your code**, not a catalogue of textbook algorithms.
2. **The diagram is derived, so it is always honest.** It cannot drift from the source.
3. **It shows execution, not just structure** (P3) — a recursion tree for recursive calls, a
   timeline for iteration.
4. **The AI is grounded in the actual graph**, so it answers about your code rather than
   the general idea of binary search.
5. **Bring your own key.** No token quota, no subscription gate on the thing that costs money.

## Principles

### 1. Derived, never duplicated
The code is truth. Anything shown about it is regenerated from it. This is why we refused
bidirectional editing in P1: a diagram that can silently disagree with the code is worse than
no diagram. When we do allow diagram-driven edits (P4), the user reviews a diff.

### 2. Degrade, never blank
A syntax error mid-typing is the normal state of writing code, not an exception. A partial parse
renders a partial graph. A failed job keeps the last good view on screen and says so. The
canvas going blank is a bug, not an error state.

### 3. Don't fake work
No skeleton loader for work that already finished. No spinner for a 50ms parse. Loading states
are reserved for real waits, so they stay informative.

### 4. Shape carries meaning
A diamond is a decision whether or not you can see colour, whether or not it's a grayscale
print, whether or not you exported to a slide deck. Colour is reinforcement, never the signal.

### 5. Their arrangement is precious
Auto-layout is disposable — regenerate it freely. A position the user dragged is work they did,
stored separately and preserved across re-parses. A transient syntax error must never destroy it.

### 6. Explain, don't decorate
An empty state says what to do next. An error says what happened in plain language. Copy earns
its place by being useful, not by being clever.

---

## Interface

### The workbench
Three panes: code left, diagram centre and dominant, AI right and collapsible. The diagram gets
the space because it's the reason someone opened the app. Under 768px it collapses to tabs —
a three-pane layout squeezed onto a phone serves nobody.

Clicking a node scrolls the editor to its line. That link is what makes the diagram feel like
it's *about* the code rather than a separate picture.

### Visual language (Hallmark, atmospheric genre, Aurora theme)

Dark by default because that's where code lives. One cool cyan accent — restrained, so it can
mean something. Two fixed radial blooms give the dark canvas depth without motion. The light
drop is a real alternate, not a stylesheet afterthought, and it **drops the blooms** because a
bloom on light paper is the aurora-blob cliché.

Monospace for anything that is code. Sans for anything that is interface. No italic headers, no
gradient text, no glassmorphism, no fake browser chrome.

### Motion
Three primitives, total: nodes settle when the layout changes, skeleton crossfades to content,
and focus rings appear instantly. That's it. The atmosphere does the work; movement is spent
where it communicates and nowhere else.

### Accessibility
Not a pass at the end. Node meaning is shape-based from the first commit. Every interactive
element ships eight states including a visible, never-animated focus ring. Contrast is verified
in both themes. `prefers-reduced-motion` collapses spatial motion to a crossfade.

---

## Deliberate non-goals

- **A general diagramming tool.** Excalidraw exists. Our canvas is about your code.
- **A code editor.** CodeMirror is an input, not a product surface. Nobody should write their
  solution here.
- **Correctness judgment.** We show what the code does, not whether it's the right algorithm.
- **Collaboration.** Not in P1–P4. Single-user first, done well.
- **A model provider.** BYOK. We never resell tokens.
- **Every language.** C++, Java, Python cover the DSA world. Others earn their way in.

## How we'll know it works

- A learner pastes a recursive solution and can explain its base case afterward.
- Someone exports a diagram into their own notes.
- A user reopens a project weeks later and their arrangement is exactly as they left it.
- The AI answers about *their* variable names, not a textbook's.

The failure mode to watch for: a diagram people look at once and never return to. That would
mean we built an illustration rather than an instrument.
