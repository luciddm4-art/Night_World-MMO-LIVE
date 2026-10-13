// Chat filter, name rules, and the pure helpers behind the admin/report commands.
// The word lists are stored ROT13-encoded only so that this file is not full of slurs; they are decoded at load.
const rot13 = (s) => s.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));

// matched anywhere inside a message ("fuuuck", "f.u.c.k" and friends too)
const STRONG = ['shpx', 'avttre', 'avttn', 'snttbg', 'ergneq'].map(rot13);
// matched only as whole words (so "Scunthorpe", "class", "assume" are fine)
const WORDS = ['fuvg', 'fuvgf', 'fuvggl', 'ovgpu', 'ovgpurf', 'phag', 'phagf', 'nffubyr', 'juber', 'fyhg', 'xvxr', 'puvax', 'fcvp'].map(rot13);

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's' }; // not '!' — it is usually just punctuation
// same length as the input, so match positions map straight back onto the original text
const fold = (s) => s.toLowerCase().replace(/[013457@$]/g, (c) => LEET[c]);
const GAP = '[\\W_]{0,2}';
const spaced = (w) => w.split('').map((c) => c + '+').join(GAP);

function build(extra = []) {
  const strong = [...STRONG, ...extra.filter((w) => w.length >= 5)];
  const words = [...WORDS, ...extra.filter((w) => w.length < 5)];
  return {
    strong: new RegExp(strong.map(spaced).join('|'), 'g'),
    words: new RegExp('(?<![a-z])(?:' + words.map(spaced).join('|') + ')(?![a-z])', 'g'),
    all: new RegExp([...strong, ...words].map((w) => w.split('').join('[\\W_]*')).join('|')),
  };
}

export function makeFilter(extraWords = []) {
  const extra = extraWords.map((w) => w.toLowerCase().replace(/[^a-z]/g, '')).filter(Boolean);
  const re = build(extra);
  return {
    // returns the text with offending parts replaced by ****
    clean(text) {
      const f = fold(text);
      const hide = new Array(text.length).fill(false);
      for (const r of [re.strong, re.words]) {
        r.lastIndex = 0;
        for (let m = r.exec(f); m; m = r.exec(f)) {
          for (let i = m.index; i < m.index + m[0].length; i++) hide[i] = true;
          if (m[0].length === 0) r.lastIndex++;
        }
      }
      return [...text].map((c, i) => (hide[i] ? '*' : c)).join('');
    },
    // names: anything containing a bad word, however it is spelled
    badName: (name) => re.all.test(fold(name).replace(/_/g, '')),
  };
}

const RESERVED = /^(admin|administrator|root|mod|moderator|gm|staff|system|server|support|owner|dev|developer|official|nightworld|nightworldonline|guest|anonymous|null|undefined)\d*$/;
export function reservedName(name) {
  return RESERVED.test(String(name).toLowerCase().replace(/[_\s]/g, ''));
}

export function parseList(env) {
  return String(env || '').split(',').map((s) => s.trim()).filter(Boolean);
}

// "/mute Bob 30 spamming" -> { cmd: 'mute', args: ['Bob','30','spamming'], rest: 'Bob 30 spamming' }
export function parseCommand(line) {
  const m = /^\/([A-Za-z]+)\s*(.*)$/.exec(line.trim());
  if (!m) return null;
  const rest = m[2].trim();
  return { cmd: m[1].toLowerCase(), args: rest ? rest.split(/\s+/) : [], rest };
}
