import assert from 'node:assert/strict';
import test from 'node:test';
import { defineStrings, wordFor } from '../src/core/strings.js';

/** An element whose nearest lang is `lang` (null: none on the way up). */
const inLang = (lang) => ({ closest: () => (lang ? { getAttribute: () => lang } : null) });

test('words come in English by default', () => {
  assert.equal(wordFor(inLang(null), 'dismiss'), 'Dismiss');
  assert.equal(wordFor(inLang(null), 'remove', 'Nightjar'), 'Remove Nightjar');
  assert.equal(wordFor(null, 'holdHint'), 'Press and hold, or activate twice, to confirm');
});

test('Italian is built in, regional variants included', () => {
  assert.equal(wordFor(inLang('it'), 'remove', 'Moth'), 'Rimuovi Moth');
  assert.equal(wordFor(inLang('it-CH'), 'sortBy', 'Livello'), 'Ordina per Livello');
  assert.equal(wordFor(inLang('IT'), 'holdArmed', 'Elimina'), 'Elimina: attiva di nuovo per confermare');
});

test('a language without words falls back to English', () => {
  assert.equal(wordFor(inLang('ja'), 'resizePanes'), 'Resize panes');
});

test('defineStrings adds a language; the words it leaves out stay English', () => {
  defineStrings('fr', { remove: (label) => `Retirer ${label}` });
  assert.equal(wordFor(inLang('fr-CA'), 'remove', 'Kestrel'), 'Retirer Kestrel');
  assert.equal(wordFor(inLang('fr'), 'dismiss'), 'Dismiss');
});

test('defineStrings changes one word of a language and keeps the others', () => {
  defineStrings('it', { dismiss: 'Ignora' });
  assert.equal(wordFor(inLang('it'), 'dismiss'), 'Ignora');
  assert.equal(wordFor(inLang('it'), 'resizePanes'), 'Ridimensiona i riquadri');
  defineStrings('it', { dismiss: 'Chiudi' });
});

test('a regional variant overrides its language word by word', () => {
  defineStrings('pt', { dismiss: 'Fechar' });
  defineStrings('pt-BR', { remove: (label) => `Remover ${label}` });
  assert.equal(wordFor(inLang('pt-BR'), 'remove', 'A'), 'Remover A');
  assert.equal(wordFor(inLang('pt-BR'), 'dismiss'), 'Fechar', 'what pt-BR leaves out comes from pt');
});
