// @vitest-environment jsdom
/**
 * Search highlighting (owner Menu workspace v5.2.1 §4): one shared
 * implementation — case-insensitive, EVERY occurrence, a <mark> in the
 * design's colours (#F5D3CD / #7A2219), no padding, font inherited.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Highlight, SEARCH_HIGHLIGHT_STYLE, markMatches } from '../Highlight';
import { markMatches as builderMarkMatches } from '../../menu-manager/builderSearchHighlight';

describe('<Highlight />', () => {
  it('marks every case-insensitive occurrence and keeps the text whole', () => {
    render(<span data-testid="t"><Highlight text="Paneer pakora with PANEER and paneer" query="Paneer" /></span>);
    const marks = screen.getAllByTestId('search-highlight-mark');
    expect(marks.map((m) => m.textContent)).toEqual(['Paneer', 'PANEER', 'paneer']);
    expect(marks.every((m) => m.tagName === 'MARK')).toBe(true);
    expect(screen.getByTestId('t').textContent).toBe('Paneer pakora with PANEER and paneer');
  });

  it('marks adjacent and overlapping-looking repeats without double counting', () => {
    render(<span data-testid="t"><Highlight text="aaaa" query="aa" /></span>);
    expect(screen.getAllByTestId('search-highlight-mark').map((m) => m.textContent)).toEqual(['aa', 'aa']);
    expect(screen.getByTestId('t').textContent).toBe('aaaa');
  });

  it('trims the query and ignores a blank one or no hit', () => {
    render(<span data-testid="t"><Highlight text="Dal makhani" query="  dal " /></span>);
    expect(screen.getAllByTestId('search-highlight-mark').map((m) => m.textContent)).toEqual(['Dal']);
    expect(markMatches('Dal', '')).toBe('Dal');
    expect(markMatches('Dal', '   ')).toBe('Dal');
    expect(markMatches('Dal', null)).toBe('Dal');
    expect(markMatches('Dal', undefined)).toBe('Dal');
    expect(markMatches('Dal', 'xyz')).toBe('Dal');
    expect(markMatches('', 'a')).toBe('');
  });

  it('uses the design highlight: #F5D3CD on #7A2219, no padding, inherited font', () => {
    render(<Highlight text="Naan" query="na" />);
    const mark = screen.getByTestId('search-highlight-mark');
    expect(mark.style.backgroundColor).toBe('rgb(245, 211, 205)');
    expect(mark.style.color).toBe('rgb(122, 34, 25)');
    expect(mark.style.padding).toBe('0px');
    expect(SEARCH_HIGHLIGHT_STYLE.font).toBe('inherit');
  });

  it('takes a testId for the marks', () => {
    render(<Highlight text="Lassi" query="ss" testId="my-mark" />);
    expect(screen.getByTestId('my-mark').textContent).toBe('ss');
  });

  it('the menu rows’ markMatches is the same implementation, keeping builder-search-mark', () => {
    render(<span>{builderMarkMatches('Chicken and chickpea', 'CHICK')}</span>);
    const marks = screen.getAllByTestId('builder-search-mark');
    expect(marks.map((m) => m.textContent)).toEqual(['Chick', 'chick']);
    expect(marks[0]!.style.backgroundColor).toBe('rgb(245, 211, 205)');
  });
});
