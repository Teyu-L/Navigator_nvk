import fs from 'fs';

const rawData = JSON.parse(fs.readFileSync('map/final_graph_floor1.json', 'utf8'));

// Function to generate aliases
function createAliases(id, floor) {
  const set = new Set();
  set.add(id);
  set.add(id.replace(/_/g, ' '));

  const roomMatches = id.match(/[A-Z]\d{3}/g) || id.match(/[A-Z]\d{2}/g);
  if (roomMatches) {
    roomMatches.forEach(rm => {
      set.add(rm);
      set.add(`Room ${rm}`);
      set.add(`Auditorium ${rm}`);
      set.add(`Aud. ${rm}`);
      set.add(`Class ${rm}`);
    });
  }

  const lower = id.toLowerCase();
  if (lower.includes('caffe')) {
    set.add('Cafeteria'); set.add('Coffee'); set.add('Dining'); set.add('Buffet');
  }
  if (lower.includes('library')) {
    set.add('Library'); set.add('Reading Hall'); set.add('Books');
  }
  if (lower.includes('rectorate')) {
    set.add('Rector Office'); set.add('Rectorate'); set.add('Administration');
  }
  if (lower.includes('medical')) {
    set.add('Medical Office'); set.add('First Aid'); set.add('Infirmary');
  }
  if (lower.includes('scool21') || lower.includes('it_lab')) {
    set.add('School 21'); set.add('IT Hub'); set.add('Computer Lab');
  }
  if (lower.includes('decanate')) {
    set.add('Dean Office'); set.add('Deanery'); set.add('Dean');
  }
  if (lower.includes('coworks')) {
    set.add('Coworking Area'); set.add('Study Zone'); set.add('Hub');
  }
  if (lower.includes('entrance')) {
    set.add('Entrance'); set.add('Exit'); set.add('Main Gate');
  }
  if (lower.includes('wc')) {
    set.add('Restroom'); set.add('Toilet'); set.add('WC'); set.add('Washroom');
  }
  if (lower.includes('stairs')) {
    set.add('Stairs'); set.add('Staircase'); set.add('Steps');
  }

  return Array.from(set);
}

// Floor 1
const f1Nodes = {};
const f1Edges = [];

for (const [id, node] of Object.entries(rawData.nodes)) {
  f1Nodes[id] = {
    x: node.x,
    y: node.y,
    floor: 1,
    search_aliases: createAliases(id, 1)
  };
}

rawData.edges.forEach(e => {
  f1Edges.push({ from: e.from, to: e.to });
});

fs.writeFileSync('public/data/floor1.json', JSON.stringify({ nodes: f1Nodes, edges: f1Edges }, null, 2));

// Helper for mapped IDs
function mapIdForFloor(id, floor) {
  let base = id;

  if (floor === 2) {
    if (id === 'Caffe') base = 'Library_201';
    else if (id === 'Scool21') base = 'Computer_Lab_202';
    else if (id === 'Medical, E107, E108') base = 'Faculty_Office_E207';
    else if (id === 'Coworks_K110') base = 'Study_Hall_K210';
  } else if (floor === 3) {
    if (id === 'Caffe') base = 'Rectorate_301';
    else if (id === 'Scool21') base = 'AI_Lab_302';
    else if (id === 'Medical, E107, E108') base = 'Conference_Hall_303';
    else if (id === 'Coworks_K110') base = 'Robotics_Lab_310';
  }

  // Replace room number 1xx -> 2xx or 3xx (also inside composite names)
  base = base.replace(/([A-Z])1(\d{2})/g, `$1${floor}$2`);

  // Vertical connectors get a floor suffix so they stay distinct yet linkable
  if (id.includes('stairs') || id.includes('entrance') || id.includes('WC') || id.includes('Node')) {
    return `${base}_f${floor}`;
  }

  return base;
}

// Floor 2
const f2Nodes = {};
const f2Edges = [];

for (const [id, node] of Object.entries(rawData.nodes)) {
  const newId = mapIdForFloor(id, 2);
  f2Nodes[newId] = {
    x: node.x,
    y: node.y,
    floor: 2,
    search_aliases: createAliases(newId, 2)
  };
}

rawData.edges.forEach(e => {
  f2Edges.push({
    from: mapIdForFloor(e.from, 2),
    to: mapIdForFloor(e.to, 2)
  });
});

fs.writeFileSync('public/data/floor2.json', JSON.stringify({ nodes: f2Nodes, edges: f2Edges }, null, 2));

// Floor 3
const f3Nodes = {};
const f3Edges = [];

for (const [id, node] of Object.entries(rawData.nodes)) {
  const newId = mapIdForFloor(id, 3);
  f3Nodes[newId] = {
    x: node.x,
    y: node.y,
    floor: 3,
    search_aliases: createAliases(newId, 3)
  };
}

rawData.edges.forEach(e => {
  f3Edges.push({
    from: mapIdForFloor(e.from, 3),
    to: mapIdForFloor(e.to, 3)
  });
});

fs.writeFileSync('public/data/floor3.json', JSON.stringify({ nodes: f3Nodes, edges: f3Edges }, null, 2));

console.log('Generated Data Summary:');
console.log('Floor 1 - Nodes:', Object.keys(f1Nodes).length, 'Edges:', f1Edges.length);
console.log('Floor 2 - Nodes:', Object.keys(f2Nodes).length, 'Edges:', f2Edges.length);
console.log('Floor 3 - Nodes:', Object.keys(f3Nodes).length, 'Edges:', f3Edges.length);
