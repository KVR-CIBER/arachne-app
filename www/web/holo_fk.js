// Forward kinematics of the ARACHNE model without MuJoCo (data from tools/usb_plan.py -> web/holo.json).
// Every joint is a hinge at its body origin, so body = parent * translate(pos) * rotate(quat) * rotate(axis, q).
// Quaternions are MuJoCo order [w, x, y, z]. Returns per body [x, y, z, w, qx, qy, qz] and the lift that puts the
// lowest foot on the floor (same rule as live_twin.py: a foot pushed below the floor lifts the robot).
'use strict';

function qmul(a, b) {
  return [a[0]*b[0] - a[1]*b[1] - a[2]*b[2] - a[3]*b[3], a[0]*b[1] + a[1]*b[0] + a[2]*b[3] - a[3]*b[2],
          a[0]*b[2] - a[1]*b[3] + a[2]*b[0] + a[3]*b[1], a[0]*b[3] + a[1]*b[2] - a[2]*b[1] + a[3]*b[0]];
}
function qrot(q, v) {           // rotate vector v by quaternion q
  const [w, x, y, z] = q, tx = 2*(y*v[2] - z*v[1]), ty = 2*(z*v[0] - x*v[2]), tz = 2*(x*v[1] - y*v[0]);
  return [v[0] + w*tx + y*tz - z*ty, v[1] + w*ty + z*tx - x*tz, v[2] + w*tz + x*ty - y*tx];
}
function axisAngle(a, t) { const s = Math.sin(t/2); return [Math.cos(t/2), a[0]*s, a[1]*s, a[2]*s]; }

const TICK = 2*Math.PI/4096;
function anglesOf(H, ticks) { return ticks.map((t, i) => t == null ? 0 : H.cal[i][1]*(t - H.cal[i][0])*TICK); }

function fk(H, q) {
  const pos = [], rot = [];
  H.tree.forEach((b, i) => {
    if (i === 0) { pos.push([0, 0, 0]); rot.push([1, 0, 0, 0]); return; }
    const pp = pos[b.parent], pr = rot[b.parent], o = qrot(pr, b.pos);
    let r = qmul(pr, b.quat);
    if (b.joint >= 0) r = qmul(r, axisAngle(b.axis, q[b.joint]));
    pos.push([pp[0] + o[0], pp[1] + o[1], pp[2] + o[2]]); rot.push(r);
  });
  const feet = H.feet.map(f => { const o = qrot(rot[f.body], f.pos), p = pos[f.body]; return [p[0] + o[0], p[1] + o[1], p[2] + o[2]]; });
  const low = Math.min(...feet.map(f => f[2]));
  const lift = Math.max(0, H.ground - (low + H.tip));
  return {bodies: pos.map((p, i) => [p[0], p[1], p[2] + lift, ...rot[i]]), lift,
          feet: feet.map(f => [f[0], f[1], f[2] + lift]), rawFeet: feet};      // rawFeet: body frame, before the floor lift
}

if (typeof window !== 'undefined') window.HoloFK = {fk, anglesOf};
if (typeof module !== 'undefined') module.exports = {fk, anglesOf};
