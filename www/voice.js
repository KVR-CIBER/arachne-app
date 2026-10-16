// Voice assistant for ARACHNE: "hey spin" wake word, Dutch commands, short spoken answers.
// Works without any key (fixed commands). With a Claude API key it also answers free questions and picks actions itself.

const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// what speech recognition makes of "hey spin": hé spin, hey spin, a spin, he spinnen, spinnetje, arachne…
const WAKE = /(?:^|\b)(?:(?:hey|hei|hee|he|hai|hi|oke|ok|okay|a|e)\s+)?(?:spin|spinnetje|spinneke|spinne|spinnen|spint|arachne|arakne|arachnee)\b/;
export function findWake(text) {
  const t = norm(text), m = t.match(WAKE);
  if (!m) return null;
  // plain "spin" in the middle of a sentence ("de spin is mooi") only counts with a greeting or at the start
  const greeted = /^(hey|hei|hee|he|hai|hi|oke|ok|okay|a|e)\s/.test(m[0]) || m.index === 0;
  if (!greeted) return null;
  return {rest: t.slice(m.index + m[0].length).trim()};
}

const num = s => { const m = s.match(/(\d+(?:[.,]\d+)?)/); if (m) return parseFloat(m[1].replace(',', '.'));
  const W = {een: 1, twee: 2, drie: 3, vier: 4, vijf: 5, zes: 6, zeven: 7, acht: 8, negen: 9, tien: 10, twintig: 20, dertig: 30, veertig: 40, vijftig: 50, honderd: 100};
  for (const [w, v] of Object.entries(W)) if (new RegExp(`\\b${w}\\b`).test(s)) return v; return null; };
// distance in the sentence: "1 meter", "50 centimeter", default otherwise (capped at 2 m)
const metres = (t, d) => { const n = num(t); if (n == null) return d; return Math.min(2, /centimeter|cm\b/.test(t) ? n/100 : /meter|\bm\b/.test(t) ? n : d); };
const TURN_RATE = .5;   // rad/s at full turn command (cockpit scale)
const turnSecs = deg => Math.min(15, (deg*Math.PI/180)/TURN_RATE);

// returns {actions: [...], say: '...'} or null when it is not a known command
export function parse(text, st = {}) {
  const t = norm(text); if (!t) return null;
  const has = re => re.test(t);
  const A = (actions, say) => ({actions, say});
  if (has(/\b(stop|stoppen|halt|stil|hou op|houd op|genoeg|sta stil|blijf staan|wacht)\b/)) return A([{arachne: 'do', what: 'stop'}], 'Oké, ik stop.');
  if (has(/\b(dans|dansen|dance|danske|swing)\b/)) return A([{arachne: 'do', what: 'dance'}], pick(['Muziek aan!', 'Kijk maar.', 'Daar gaan we.']));
  if (has(/\btwist\b/)) return A([{arachne: 'do', what: 'twist'}], 'Twisten!');
  if (has(/\b(zwaai|zwaaien|hallo zeggen|zeg hallo|dag zeggen|zeg dag|wave)\b/)) return A([{arachne: 'do', what: 'wave'}], 'Hallo!');
  if (has(/\b(push ?ups?|pushups|opdrukken|sporten|workout)\b/)) return A([{arachne: 'do', what: 'pushups'}], 'Even sporten.');
  if (has(/\b(kijk rond|rondkijken|om je heen|rond kijken)\b/)) return A([{arachne: 'do', what: 'look'}], 'Even rondkijken.');
  if (has(/\b(buig|buigen|buiging|maak een buiging)\b/)) return A([{arachne: 'do', what: 'bow'}], 'Dank u, dank u.');
  if (has(/\b(sta op|opstaan|recht|ga staan|word wakker|wakker worden)\b/)) return A([{arachne: 'do', what: 'stand'}], 'Ik sta op.');
  if (has(/\b(ga liggen|lig|liggen|slapen|ga slapen|rust|gaan liggen)\b/)) return A([{arachne: 'do', what: 'lie'}], 'Ik ga liggen.');
  for (const [g, nl] of [['tripod', 'tripod'], ['ripple', 'ripple'], ['wave', 'golf']]) if (has(new RegExp(`\\b${nl}( ?gang)?\\b`)) && has(/gang|\bloop|\bstap|\bwandel/)) return A([{arachne: 'set', values: {gait: g}}], `Ik loop nu met de ${nl}gang.`);
  if (has(/\b(draai om|omdraaien|draai je om|keer om|omkeren|180)\b/)) return A([{arachne: 'turn', deg: 180}], 'Ik draai me om.');
  if (has(/\bdraai\b|\bdraaien\b/)) {
    const deg = num(t) || 90, dir = has(/\brechts\b/) ? -1 : 1;
    return A([{arachne: 'turn', deg: dir*Math.min(720, deg)}], `${Math.round(deg)} graden naar ${dir > 0 ? 'links' : 'rechts'}.`);
  }
  if (has(/\bnormaal\b|\bgewone hoogte\b/)) return A([{arachne: 'set', values: {height: 0, speed: 1, roll: 0, pitch: 0, yaw: 0, x: 0}}], 'Terug normaal.');
  if (has(/\b(kom|kom hier|kom naar mij|kom eens|hierheen|naar hier)\b/)) return A([{arachne: 'walk', m: .4}], 'Ik kom eraan.');
  if (has(/\b(achteruit|terug|naar achter|ga weg)\b/)) return A([{arachne: 'walk', m: -metres(t, .2)}], 'Achteruit.');
  if (has(/\bopzij\b|\bzijwaarts\b|\bstap\b.*\b(links|rechts)\b|\bkrab\b/)) { const d = has(/\brechts\b/) ? -1 : 1; return A([{arachne: 'walk', dir: 'y', m: d*metres(t, .15)}], `Opzij naar ${d > 0 ? 'links' : 'rechts'}.`); }
  if (has(/\b(loop|lopen|vooruit|wandel|wandelen|ga vooruit|rij)\b/)) return A([has(/\b(seconde|seconden|sec)\b/) ? {arachne: 'drive', vx: 1, secs: Math.min(15, num(t) || 4)} : {arachne: 'walk', m: metres(t, .3)}], 'Vooruit.');
  if (has(/\bsneller\b/)) return A([{arachne: 'set', values: {speed: Math.min(1.5, (st.speed || 1) + .2)}}], 'Sneller.');
  if (has(/\b(trager|langzamer|rustiger|stiller)\b/)) return A([{arachne: 'set', values: {speed: Math.max(.2, (st.speed || 1) - .2)}}], 'Rustiger.');
  if (has(/\bhoger\b/)) return A([{arachne: 'set', values: {height: .015}}], 'Hoger.');
  if (has(/\blager\b|\bbuk\b|\bduik\b/)) return A([{arachne: 'set', values: {height: -.025}}], 'Lager.');
  // questions
  if (has(/\b(volt|spanning|batterij|voeding|accu|stroom)\b/)) return A([], st.connected ? `De spanning is ${say(st.volt)} volt en ik trek ${say(st.amp)} ampère.` : 'Ik heb geen verbinding met de robot.');
  if (has(/\bhoe gaat het\b|\bhoe voel je\b|\balles goed\b/)) return A([], st.connected ? (st.brownouts ? `Gaat wel, ik had al ${st.brownouts} keer te weinig spanning.` : `Goed! Ik sta ${st.stable_mm} millimeter stabiel.`) : 'Ik voel me een beetje los: geen verbinding.');
  if (has(/\bwat doe je\b|\bwaar ben je mee bezig\b/)) return A([], st.connected ? `Ik ben aan het ${st.doing}.` : 'Niks, ik heb geen verbinding.');
  if (has(/\bhoe ver\b|\bafstand\b|\bgelopen\b/)) return A([], st.connected ? `Ik heb ${say(st.walked_m)} meter gelopen.` : 'Dat weet ik niet.');
  if (has(/\bhoe laat\b/)) { const d = new Date(); return A([], `Het is ${d.getHours()} uur ${d.getMinutes()}.`); }
  if (has(/\bwie ben je\b|\bwat ben je\b|\bhoe heet je\b|\bstel je voor\b/)) return A([], 'Ik ben ARACHNE, een spin met zes poten en achttien servo\'s. Zeg maar wat ik moet doen.');
  if (has(/\bwat kan je\b|\bwat kun je\b|\bhelp\b/)) return A([], 'Ik kan dansen, zwaaien, push-ups doen, rondkijken, buigen, lopen, draaien en naar je toe komen. Vraag ook maar naar mijn batterij.');
  if (has(/\b(dank|merci|bedankt|goed zo|braaf|super)\b/)) return A([{arachne: 'do', what: 'bow'}], pick(['Graag gedaan.', 'Altijd.', 'Dank je!']));
  return null;
}
const say = v => String(Math.round((v || 0)*10)/10).replace('.', ' komma ');
const pick = a => a[Math.floor(Math.random()*a.length)];

// ------------------------------------------------------------------ Claude (optional, free questions)
const TOOLS = [
  {name: 'do_action', description: 'Let the robot perform a built-in action.', input_schema: {type: 'object', properties: {what: {type: 'string', enum: ['stand', 'lie', 'stop', 'dance', 'wave', 'pushups', 'look', 'bow', 'twist']}}, required: ['what']}},
  {name: 'walk', description: 'Walk or turn for some seconds. vx forward(+)/back(-), vy left(+)/right(-), wz turn left(+)/right(-), each -1..1. Full turn speed is about 29 degrees per second.', input_schema: {type: 'object', properties: {vx: {type: 'number'}, vy: {type: 'number'}, wz: {type: 'number'}, secs: {type: 'number'}}, required: ['secs']}},
  {name: 'turn', description: 'Turn on the spot by a number of degrees, positive = left, negative = right. Measured, so 180 is exactly turning around.', input_schema: {type: 'object', properties: {deg: {type: 'number'}}, required: ['deg']}},
  {name: 'walk_distance', description: 'Walk a measured distance in metres (max 2). Negative = backwards. sideways=true walks left (+) / right (-).', input_schema: {type: 'object', properties: {m: {type: 'number'}, sideways: {type: 'boolean'}}, required: ['m']}},
  {name: 'set_params', description: 'Change gait (tripod|ripple|wave), speed 0.2-1.5, body height in metres (-0.035..0.025), step_h in metres (0.008..0.05).', input_schema: {type: 'object', properties: {gait: {type: 'string'}, speed: {type: 'number'}, height: {type: 'number'}, step_h: {type: 'number'}}}},
];
const history = [];
export async function askClaude(key, text, state, run) {
  const system = `Je bent de stem van ARACHNE, een zespotige robotspin (18 STS3215-servo's, Raspberry Pi) gebouwd door Kobe. ` +
    `Je praat via een tablet. Antwoord in het Vlaams-Nederlands, kort en natuurlijk om uit te spreken: hoogstens twee zinnen, geen opsommingen of emoji. ` +
    `Gebruik de tools om te bewegen als dat gevraagd wordt. Huidige toestand: ${JSON.stringify(state)}. ` +
    (state.target === 'robot' ? 'Je bestuurt nu de echte robot.' : 'Je bestuurt nu de simulatie, de echte robot beweegt niet.');
  history.push({role: 'user', content: text});
  while (history.length > 12) history.shift();
  while (history.length && history[0].role !== 'user') history.shift();
  for (let round = 0; round < 4; round++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {method: 'POST', headers: {'content-type': 'application/json', 'x-api-key': key,
      'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true'},
      body: JSON.stringify({model: 'claude-haiku-5-5', max_tokens: 300, system, tools: TOOLS, messages: history})});
    if (!r.ok) { history.pop(); throw new Error(r.status === 401 ? 'De Claude-sleutel werkt niet.' : `Claude gaf fout ${r.status}.`); }
    const j = await r.json();
    history.push({role: 'assistant', content: j.content});
    const calls = j.content.filter(c => c.type === 'tool_use');
    if (!calls.length) return j.content.filter(c => c.type === 'text').map(c => c.text).join(' ').trim();
    const results = [];
    for (const c of calls) {
      const i = c.input || {};
      if (c.name === 'do_action') await run({arachne: 'do', what: i.what});
      else if (c.name === 'walk') await run({arachne: 'drive', vx: i.vx || 0, vy: i.vy || 0, wz: i.wz || 0, secs: Math.min(15, i.secs || 2)});
      else if (c.name === 'turn') await run({arachne: 'turn', deg: i.deg});
      else if (c.name === 'walk_distance') await run({arachne: 'walk', m: Math.max(-2, Math.min(2, i.m)), dir: i.sideways ? 'y' : 'x'});
      else if (c.name === 'set_params') await run({arachne: 'set', values: i});
      results.push({type: 'tool_result', tool_use_id: c.id, content: 'ok'});
    }
    history.push({role: 'user', content: results});
  }
  return 'Oké.';
}
