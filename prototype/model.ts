export type Narration = 'single' | 'cast';
export type Role = {name: string; voice: string};
export type Book = {
  id: string; title: string; author: string; style: string;
  status: 'Draft' | 'Creating' | 'Ready'; progress: number; step: number;
  voice: string; cover?: string; format: string; chapters: string;
  narration: Narration; cast: Role[]; unknown: string; method: string;
  characters: number; firstChapterCharacters: number; reserved: number;
};
export type Transaction = {id: string; label: string; credits: number};
export type Studio = {books: Book[]; balance: number; ledger: Transaction[]};
export const uid = () => globalThis.crypto?.randomUUID?.() ?? `demo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const defaultCast: Role[] = [{name: 'Mrs. Bennet', voice: 'Beatrix'}, {name: 'Mr. Bennet', voice: 'Sterling'}];
const base = {step: 1, progress: 0, voice: 'Clara', format: 'M4B', chapters: 'All chapters', narration: 'single' as const, cast: defaultCast, unknown: 'Narrator', method: 'Match character voices', characters: 500_000, firstChapterCharacters: 18_000, reserved: 0};
export const seed: Book[] = [
  {...base, id: 'garden', title: 'The Secret Garden', author: 'Frances Hodgson Burnett', style: 'garden', status: 'Draft'},
  {...base, id: 'pride', title: 'Pride and Prejudice', author: 'Jane Austen', style: 'pride', status: 'Creating', progress: 42, step: 3, narration: 'cast', voice: 'Beatrix'},
  {...base, id: 'time', title: 'The Time Machine', author: 'H. G. Wells', style: 'time', status: 'Ready', progress: 100, step: 3, voice: 'Sterling'},
  {...base, id: 'jane', title: 'Jane Eyre', author: 'Charlotte Brontë', style: 'jane', status: 'Ready', progress: 100, step: 3},
];
export function freshStudio(): Studio {return {books: structuredClone(seed), balance: 150, ledger: [{id: 'opening', label: 'Opening demo balance', credits: 150}]};}
export function readStudio(): Studio {
  try {
    const value = JSON.parse(localStorage.getItem('kenkui-prototype-v2') || 'null');
    if (value && Array.isArray(value.books) && Number.isFinite(value.balance)) return value;
    const previous = JSON.parse(localStorage.getItem('kenkui-prototype-v1') || 'null');
    if (Array.isArray(previous)) return {...freshStudio(), books: previous.map(b => ({...base, ...b, format: 'M4B'}))};
  } catch { /* Start clean when local storage is unavailable. */ }
  return freshStudio();
}
/** Mirrors the default server pricing.py integer formula. Production uses server preflight. */
export function quote(characters: number, mode: Narration): number {
  return Math.ceil(characters * 126 * (mode === 'cast' ? 3 : 2) / 1_000_000);
}
export const speechCharacters = (b: Book) => b.chapters === 'First chapter only' ? b.firstChapterCharacters : b.characters;
export const bookPrice = (b: Book) => quote(speechCharacters(b), b.narration);
export const dollars = (credits: number) => `$${(credits / 100).toFixed(2)}`;
