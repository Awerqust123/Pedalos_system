const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('Missing SUPABASE env vars');
    process.exit(1);
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const app = express();
app.use(cors());
app.use(express.json());

async function requireAdmin(req, res, next) {
    const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
    if (!token) return res.status(401).json({ error: 'No token' });

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return res.status(401).json({ error: 'Invalid token' });

    const { data: roleRow } = await supabaseAdmin.from('user_roles')
        .select('role_key').eq('user_id', userData.user.id).eq('role_key', 'admin').maybeSingle();

    if (!roleRow) return res.status(403).json({ error: 'Admin only' });
    req.callerId = userData.user.id;
    next();
}

app.post('/admin/create-user', requireAdmin, async (req, res) => {
    const { username, password, display_name } = req.body;
    const fakeEmail = `${username.toLowerCase().replace(/\s+/g, '_')}@pedalos.team`;

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({ email: fakeEmail, password, email_confirm: true });
    if (createErr) return res.status(400).json({ error: createErr.message });

    const { error: profileErr } = await supabaseAdmin.from('profiles').insert({ id: created.user.id, display_name });
    if (profileErr) {
        await supabaseAdmin.auth.admin.deleteUser(created.user.id);
        return res.status(400).json({ error: profileErr.message });
    }
    res.json({ id: created.user.id, username, display_name });
});

app.delete('/admin/delete-user/:id', requireAdmin, async (req, res) => {
    if (req.params.id === req.callerId) return res.status(400).json({ error: 'Cannot delete yourself' });
    await supabaseAdmin.auth.admin.deleteUser(req.params.id);
    res.json({ deleted: true });
});

app.post('/admin/deactivate-user/:id', requireAdmin, async (req, res) => {
    await supabaseAdmin.from('profiles').update({ is_active: !!req.body.is_active }).eq('id', req.params.id);
    res.json({ success: true });
});

app.listen(process.env.PORT || 3000, () => console.log('Admin Server is running'));