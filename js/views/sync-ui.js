// The Sync card on the More screen: project config, account, family, invites.
import { sync, onSyncChange, setConfig, clearConfig, parseConfig, isBaked, needsSignIn, budget, QUOTA,
         uploadEverything, pushNow, init as initSync } from '../sync.js';

// Account, family and invite actions only exist with REQUIRE_SIGN_IN; fetch them when needed.
const accounts = () => import('../sync-accounts.js');
import { esc, icon, toast, confirm, sheet } from '../ui.js';
import { db } from '../db.js';
import { ago } from '../format.js';

const STATUS = {
  off:          { dot: '○', text: 'Not connected' },
  loading:      { dot: '◐', text: 'Connecting…' },
  'signed-out': { dot: '○', text: 'Signed out' },
  'no-family':  { dot: '◐', text: 'Signed in — no family yet' },
  live:         { dot: '●', text: 'Syncing' },
  error:        { dot: '✕', text: 'Problem' },
};

export function syncCard() {
  const s = STATUS[sync.state] || STATUS.off;
  let body = '';

  // Without sign-in there is no account or family to manage — just a connection.
  if (!needsSignIn() && sync.state === 'live') {
    return `<section class="card tone-sleep" id="sync-card">
      <div class="card-head"><span class="chip-ico">${icon('i-cloud')}</span><span class="card-title">Sync</span>
        <span class="meta"><span class="pill">${esc(s.text)}</span></span></div>
      <p class="sub">Both phones read and write <b>${esc(sync.family?.name || 'the shared log')}</b>.
        New entries appear on the other phone within a second or two, and anything logged with no
        signal uploads when you are back.</p>
      <p class="sub">${sync.pending ? `${sync.pending} change${sync.pending === 1 ? '' : 's'} waiting to upload`
        : sync.lastSync ? `Up to date · last synced ${esc(ago(sync.lastSync))}` : 'Up to date'}</p>
      ${usageLine()}
      ${sync.throttled ? `<p class="banner">This phone hit its daily ${sync.throttled === 'writes' ? 'upload' : 'download'} allowance
        (kept well under Firebase's free tier). ${sync.throttled === 'writes' ? 'Entries are saved here and upload' : 'Syncing resumes'} after midnight — nothing is lost.</p>` : ''}
      ${sync.error ? `<p class="banner">${esc(sync.error)}</p>` : ''}
      <div class="row">
        <button class="btn tone" data-sync="push">${icon('i-cloud', 'sm')}Sync now</button>
        <button class="btn" data-sync="reupload">Re-upload this phone</button>
      </div>
    </section>`;
  }

  switch (sync.state) {
    case 'off':
      body = isBaked()
        ? `<p class="sub">A project is configured but did not load. Check the connection and retry.</p>
           <div class="row"><button class="btn primary wide" data-sync="retry">Retry</button></div>`
        : `<p class="sub">Both phones see the same data once this points at a Firebase project.
           The usual way is to paste the config into <code>assets/firebase-config.js</code> in the
           repo. You can also paste it here to try it on this phone only.</p>
           <label class="field"><span>Firebase config</span>
             <textarea name="cfg" placeholder="const firebaseConfig = { apiKey: ... }"></textarea></label>
           <div class="row"><button class="btn primary wide" data-sync="save-config">Connect project</button></div>`;
      break;

    case 'loading':
      body = `<p class="sub">Loading the Firebase SDK…</p>`;
      break;

    case 'error':
      body = `<p class="banner">${esc(sync.error)}</p>
        <div class="row">
          <button class="btn" data-sync="retry">Retry</button>
          <button class="btn danger" data-sync="forget">Disconnect project</button>
        </div>`;
      break;

    case 'signed-out':
      body = `<p class="sub">Sign in on each caregiver's phone with their own email.</p>
        <label class="field"><span>Your name</span><input name="name" autocomplete="name" placeholder="e.g. Alaina"></label>
        <label class="field"><span>Email</span><input name="email" type="email" autocomplete="username" inputmode="email"></label>
        <label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password"></label>
        <div class="row">
          <button class="btn primary" data-sync="sign-in">Sign in</button>
          <button class="btn" data-sync="sign-up">Create account</button>
        </div>
        <div class="row"><button class="btn ghost wide" data-sync="forget">Use a different project</button></div>`;
      break;

    case 'no-family':
      body = `<p class="sub">Signed in as ${esc(sync.user?.email || '')}. Create a family for this
        baby, or join the one the other caregiver already made.</p>
        <div class="row"><button class="btn primary wide" data-sync="create-family">Create a family</button></div>
        <label class="field"><span>…or join with an invite code</span>
          <input name="code" placeholder="ABCD2345" autocapitalize="characters" spellcheck="false"></label>
        <div class="row">
          <button class="btn" data-sync="join-family">Join</button>
          <button class="btn ghost" data-sync="sign-out">Sign out</button>
        </div>`;
      break;

    case 'live': {
      const members = Object.values(sync.family?.members || {});
      body = `<p class="sub"><b>${esc(sync.family?.name || 'Family')}</b> · ${members.length}
        caregiver${members.length === 1 ? '' : 's'}: ${esc(members.map(m => m.name || m.email).join(', '))}</p>
        <p class="sub">${sync.pending ? `${sync.pending} change${sync.pending === 1 ? '' : 's'} waiting to upload`
          : sync.lastSync ? `Up to date · last synced ${esc(ago(sync.lastSync))}` : 'Up to date'}</p>
        ${sync.error ? `<p class="banner">${esc(sync.error)}</p>` : ''}
        <div class="row">
          <button class="btn primary" data-sync="invite">Invite caregiver</button>
          <button class="btn" data-sync="push">Sync now</button>
        </div>
        <div class="row"><button class="btn ghost wide" data-sync="sign-out">Sign out of this device</button></div>`;
      break;
    }
  }

  return `<section class="card tone-sleep" id="sync-card">
    <div class="card-head"><span class="chip-ico">${icon('i-cloud')}</span><span class="card-title">Sync</span>
      <span class="meta">${s.dot} ${esc(s.text)}</span></div>
    ${body}
  </section>`;
}

function usageLine() {
  const b = budget();
  const pct = Math.max(b.reads / QUOTA.reads, b.writes / QUOTA.writes) * 100;
  return `<p class="sub usage"><span class="muted">Firebase today · this phone:</span>
    ${b.reads.toLocaleString()} reads · ${b.writes.toLocaleString()} writes
    <span class="muted">(free tier ${QUOTA.reads.toLocaleString()} / ${QUOTA.writes.toLocaleString()} a day · ${pct < 1 ? 'under 1' : pct.toFixed(0)}% used)</span></p>`;
}

/** Re-render just the sync card in place, so typing elsewhere is not disturbed. */
function repaint(ctx) {
  const card = document.getElementById('sync-card');
  if (!card) return;
  const next = document.createElement('div');
  next.innerHTML = syncCard();
  card.replaceWith(next.firstElementChild);
}

export function wireSync(root, ctx) {
  const off = onSyncChange(() => repaint(ctx));
  root.addEventListener('viewteardown', off, { once: true });

  root.addEventListener('click', async e => {
    const act = e.target.closest('[data-sync]')?.dataset.sync;
    if (!act) return;
    const field = name => root.querySelector(`#sync-card [name="${name}"]`);
    const btn = e.target.closest('[data-sync]');
    const busy = on => { btn.disabled = on; btn.textContent = on ? 'Working…' : btn.textContent; };

    try {
      switch (act) {
        case 'save-config': {
          const cfg = parseConfig(field('cfg').value);
          await setConfig(cfg);                       // reloads the page
          break;
        }

        case 'retry': await initSync(); break;

        case 'forget':
          if (await confirm('Disconnect this Firebase project? Local data stays on this device.',
                            { okLabel: 'Disconnect' })) await clearConfig();
          break;

        case 'sign-in':
        case 'sign-up': {
          const email = field('email').value.trim();
          const password = field('password').value;
          const name = field('name').value.trim();
          if (!email || !password) return toast('Email and password are required');
          busy(true);
          if (act === 'sign-up') {
            await (await accounts()).signUp(email, password, name);
            toast('Account created');
          } else {
            await (await accounts()).signIn(email, password);
            toast('Signed in');
          }
          if (name) await ctx.setCaregiver(name);
          break;
        }

        case 'sign-out':
          if (!await confirm('Sign out? Data already on this device stays.', { okLabel: 'Sign out' })) return;
          await (await accounts()).signOutNow();
          break;

        case 'create-family': {
          busy(true);
          const name = ctx.state.profile?.name ? `${ctx.state.profile.name}'s family` : 'Our family';
          await (await accounts()).createFamily(name);
          toast('Family created — uploading your history');
          break;
        }

        case 'join-family': {
          const code = field('code').value.trim();
          if (!code) return toast('Enter the invite code');
          busy(true);
          await (await accounts()).joinFamily(code);
          toast('Joined — syncing');
          break;
        }

        case 'invite': {
          const { code, expires } = await (await accounts()).createInvite();
          await sheet({
            title: 'Invite the other caregiver',
            body: `<p class="sub">On their phone: open this app, connect the same Firebase project,
              create an account, then enter this code.</p>
              <p style="font-size:34px;font-weight:700;letter-spacing:.12em;text-align:center;padding:14px 0">${esc(code)}</p>
              <p class="sub">Valid until ${esc(new Date(expires).toLocaleString())}.</p>`,
            actions: [
              { label: 'Copy code', cls: 'primary', onClick: () => { navigator.clipboard?.writeText(code); toast('Copied'); return false; } },
              { label: 'Close invites now', cls: 'ghost', onClick: async (_b, close) => { await (await accounts()).revokeInvites(); toast('Invites closed'); close(null); return false; } },
            ],
          });
          break;
        }

        case 'push':
          await pushNow();
          toast('Synced');
          break;

        case 'reupload': {
          const n = await db.count();
          if (!await confirm(`Send all ${n.toLocaleString()} entries on this phone again? That is ${n.toLocaleString()} writes of the ${QUOTA.writes.toLocaleString()} a day Firebase allows for free; anything over this phone's share waits for midnight.`,
                             { danger: false, okLabel: 'Upload' })) return;
          busy(true);
          await uploadEverything();
          await pushNow();
          toast('Uploaded');
          break;
        }
      }
    } catch (err) {
      console.error(err);
      toast(err?.message || String(err));
    } finally {
      if (btn) btn.disabled = false;
      repaint(ctx);
    }
  });
}
