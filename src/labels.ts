import { GraphNode } from './types';

/**
 * Единый источник русских подписей и поисковых алиасов для узлов графа.
 * Используется и для отображения (getDisplayName), и для поиска (buildAliases),
 * поэтому названия и алиасы не могут разойтись.
 */

const DIRECTIONS: Record<string, string> = {
  north: 'сев.',
  south: 'южн.',
  east: 'вост.',
  west: 'зап.',
  central: 'центр.'
};

interface Landmark {
  test: RegExp;
  ru: string;
  en: string[];
}

const LANDMARKS: Landmark[] = [
  { test: /caffe/i, ru: 'Столовая', en: ['Cafeteria', 'Coffee', 'Dining', 'Buffet', 'Столовая', 'Буфет', 'Кофе'] },
  { test: /library/i, ru: 'Библиотека', en: ['Library', 'Reading Hall', 'Books', 'Читальный зал'] },
  { test: /rectorate/i, ru: 'Ректорат', en: ['Rectorate', 'Rector Office', 'Ректор'] },
  { test: /medical/i, ru: 'Медпункт', en: ['Medical', 'First Aid', 'Infirmary', 'Первая помощь', 'Врач'] },
  { test: /decanate|faculty/i, ru: 'Деканат', en: ['Dean Office', 'Deanery', 'Dean', 'Факультет'] },
  { test: /coworks/i, ru: 'Коворкинг', en: ['Coworking', 'Study Zone', 'Зона отдыха'] },
  { test: /study_hall/i, ru: 'Читальный зал', en: ['Study Hall'] },
  { test: /scool21|it_lab/i, ru: 'Школа 21', en: ['School 21', 'IT Hub', 'Компьютерный класс'] },
  { test: /computer_lab/i, ru: 'Компьютерный класс', en: ['Computer Lab'] },
  { test: /ai_lab/i, ru: 'Лаборатория ИИ', en: ['AI Lab'] },
  { test: /conference/i, ru: 'Конференц-зал', en: ['Conference Hall', 'Актовый зал'] },
  { test: /robotics/i, ru: 'Лаборатория робототехники', en: ['Robotics Lab', 'Робототехника'] },
  { test: /auditorium/i, ru: 'Актовый зал', en: ['Auditorium Hall'] },
  { test: /wandrobe|wardrobe/i, ru: 'Гардероб', en: ['Wardrobe'] }
];

const ROOM_WORDS = {
  ru: ['Ауд.', 'Аудитория', 'Кабинет'],
  en: ['Room', 'Auditorium', 'Aud.', 'Class']
};

/** Извлекает ключи лестниц из составных id: D_west, K_south, F_main и т.п. */
export function extractStairKeys(rawId: string): string[] {
  const tokens = rawId.split('_');
  const keys: string[] = [];

  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i].toLowerCase() !== 'stairs') continue;

    const wing = tokens[i + 1];
    if (!/^[A-Za-z]$/.test(wing)) continue;

    const next = (tokens[i + 2] || '').toLowerCase();
    const direction = next in DIRECTIONS ? next : 'main';
    keys.push(`${wing.toUpperCase()}_${direction}`);
  }

  return Array.from(new Set(keys));
}

function formatStairKey(key: string): string {
  const [wing, direction] = key.split('_');
  return direction === 'main' ? `Лестница ${wing}` : `Лестница ${wing} (${DIRECTIONS[direction]})`;
}

/** Человекочитаемое название точки для интерфейса. */
export function getDisplayName(node: GraphNode): string {
  const rawId = node.rawId || node.id;
  const floorLabel = `Этаж ${node.floor}`;

  if (/entrance/i.test(rawId)) {
    const wing = rawId.match(/entrance_([A-Z])/i)?.[1];
    return `Вход${wing ? ' ' + wing.toUpperCase() : ''} · ${floorLabel}`;
  }

  const stairKeys = extractStairKeys(rawId);
  const landmark = LANDMARKS.find(item => item.test.test(rawId));
  if (landmark && !/^stairs_/i.test(rawId)) {
    return `${landmark.ru}${roomSuffix(rawId)} · ${floorLabel}`;
  }

  if (stairKeys.length > 0) {
    const stairs = stairKeys.map(formatStairKey).join(' / ');
    const wc = formatWc(rawId);
    return `${stairs}${wc ? ` / ${wc}` : ''} · ${floorLabel}`;
  }

  const wc = formatWc(rawId);
  if (wc) {
    return `${wc} · ${floorLabel}`;
  }

  if (landmark) {
    return `${landmark.ru}${roomSuffix(rawId)} · ${floorLabel}`;
  }

  const rooms = rawId.match(/[A-Z]\d{3}/g);
  return `${rooms ? rooms.join(', ') : rawId.replace(/_/g, ' ')} · ${floorLabel}`;
}

/** «Санузел K» / «Санузел F (ауд. F303)» для узлов, где санузел — часть id. */
function formatWc(rawId: string): string | null {
  const match = rawId.match(/(?:^|_)WC_([A-Z])(?:_|$)/i);
  if (!match) return null;

  const wing = match[1].toUpperCase();
  const room = rawId.match(/WC_[A-Z]_([A-Z]\d{3})/i)?.[1];
  return `Санузел ${wing}${room ? ` (ауд. ${room})` : ''}`;
}

/** Все варианты, по которым точку можно найти (рус/англ, код аудитории, сокращения). */
export function buildAliases(rawId: string): string[] {
  const aliases = new Set<string>([rawId, rawId.replace(/_/g, ' ')]);

  for (const room of rawId.match(/[A-Z]\d{3}/g) ?? []) {
    const number = room.replace(/^[A-Z]+/, '');
    aliases.add(room);
    aliases.add(number);
    for (const word of ROOM_WORDS.en) aliases.add(`${word} ${room}`);
    for (const word of ROOM_WORDS.ru) aliases.add(`${word} ${room}`);
    for (const word of ROOM_WORDS.ru) aliases.add(`${word} ${number}`);
  }

  for (const landmark of LANDMARKS) {
    if (!landmark.test.test(rawId)) continue;
    aliases.add(landmark.ru);
    for (const english of landmark.en) aliases.add(english);
  }

  if (/entrance/i.test(rawId)) {
    for (const word of ['Вход', 'Выход', 'Главный вход', 'Entrance', 'Exit', 'Main Gate']) {
      aliases.add(word);
    }
  }
  if (/wc/i.test(rawId)) {
    for (const word of ['Санузел', 'Туалет', 'WC', 'Restroom', 'Toilet']) aliases.add(word);
  }  if (/stairs/i.test(rawId)) {
    for (const word of ['Лестница', 'Stairs', 'Staircase']) aliases.add(word);
  }

  return Array.from(aliases);
}

function roomSuffix(rawId: string): string {
  const rooms = rawId.match(/[A-Z]\d{3}/g);
  return rooms ? ` (ауд. ${rooms.join(', ')})` : '';
}
