import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ExportMenu, type ExportRequest } from './ExportMenu';

afterEach(() => cleanup());

function openMenu(props = {}) {
  const onExport = vi.fn();
  render(
    <ExportMenu canExport exporting={false} whyDisabled={null} error={null} onExport={onExport} {...props} />,
  );
  fireEvent.click(screen.getByRole('button', { name: /export the diagram/i }));
  return onExport;
}

describe('ExportMenu', () => {
  it('disables the trigger with a reason when nothing is exportable', () => {
    render(
      <ExportMenu
        canExport={false}
        whyDisabled="Nothing to export yet."
        exporting={false}
        error={null}
        onExport={() => {}}
      />,
    );
    const trigger = screen.getByRole('button', { name: /unavailable/i });
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAttribute('title', 'Nothing to export yet.');
  });

  it('opens the options panel on click', () => {
    openMenu();
    expect(screen.getByRole('group', { name: /export options/i })).toBeInTheDocument();
  });

  it('calls onExport with the default PNG 2× paper request', () => {
    const onExport = openMenu();
    fireEvent.click(screen.getByRole('button', { name: /download png/i }));
    const req: ExportRequest = onExport.mock.calls[0][0];
    expect(req).toEqual({ format: 'png', scale: 2, background: 'paper' });
  });

  it('disables transparent for JPEG with a reason, switching to white', () => {
    const onExport = openMenu();
    // Start from transparent, then pick JPEG: the menu must move, not go silent.
    fireEvent.click(screen.getByRole('radio', { name: /transparent/i }));
    fireEvent.click(screen.getByRole('radio', { name: /jpeg/i }));
    const transparent = screen.getByRole('radio', { name: /transparent/i }) as HTMLInputElement;
    expect(transparent).toBeDisabled();
    expect(transparent.title).toMatch(/no transparency/i);
    expect(screen.getByText(/switches to white/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /download jpeg/i }));
    expect((onExport.mock.calls[0][0] as ExportRequest).background).toBe('white');
  });

  it('presents JPEG once — jpg and jpeg are one format', () => {
    openMenu();
    expect(screen.getAllByRole('radio', { name: /jpeg/i })).toHaveLength(1);
    expect(screen.queryByRole('radio', { name: /^jpg$/i })).not.toBeInTheDocument();
  });

  it('disables size for SVG with a reason', () => {
    const onExport = openMenu();
    fireEvent.click(screen.getByRole('radio', { name: /svg/i }));
    expect(screen.getByText(/size doesn’t apply|size doesn't apply/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /download svg/i }));
    expect((onExport.mock.calls[0][0] as ExportRequest).scale).toBe(1);
  });

  it('shows a loading state while an export runs', () => {
    render(
      <ExportMenu canExport exporting whyDisabled={null} error={null} onExport={() => {}} />,
    );
    expect(screen.getByRole('button', { name: /exporting the diagram/i })).toBeDisabled();
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });

  it('renders the failure reason with a retry path', () => {
    const onExport = vi.fn();
    render(
      <ExportMenu
        canExport
        exporting={false}
        whyDisabled={null}
        error="Too large."
        onExport={onExport}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /export the diagram/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/too large/i);
    // Retry is pressing Download again.
    fireEvent.click(screen.getByRole('button', { name: /download png/i }));
    expect(onExport).toHaveBeenCalledTimes(1);
  });
});
