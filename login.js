// login.js — Auth logic for login.html

const API = 'http://localhost:3000/api';

// Redirect if already logged in
if (sessionStorage.getItem('token')) {
    window.location.href = '/Ticketing.html';
}

function switchTab(tab) {
    document.getElementById('loginTab').classList.toggle('active', tab === 'login');
    document.getElementById('registerTab').classList.toggle('active', tab === 'register');
    document.getElementById('loginPanel').classList.toggle('active', tab === 'login');
    document.getElementById('registerPanel').classList.toggle('active', tab === 'register');
}

function togglePassword(id, icon) {
    const input = document.getElementById(id);
    if (input.type === 'password') {
        input.type = 'text';
        icon.classList.replace('fa-eye', 'fa-eye-slash');
    } else {
        input.type = 'password';
        icon.classList.replace('fa-eye-slash', 'fa-eye');
    }
}

function fillLogin(email, password) {
    document.getElementById('loginEmail').value = email;
    document.getElementById('loginPassword').value = password;
    document.getElementById('loginEmail').focus();
}

function showError(id, message) {
    const el = document.getElementById(id);
    el.textContent = message;
    el.style.display = 'block';
}

function hideError(id) {
    document.getElementById(id).style.display = 'none';
}

function showSuccess(id, message) {
    const el = document.getElementById(id);
    el.textContent = message;
    el.style.display = 'block';
}

async function handleLogin(e) {
    e.preventDefault();
    hideError('loginError');

    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const btn = document.getElementById('loginBtn');

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Logging in...';

    try {
        const res = await fetch(`${API}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const data = await res.json();

        if (!res.ok) {
            showError('loginError', data.error || 'Login failed. Please check your credentials.');
            return;
        }

        // Store auth data
        sessionStorage.setItem('token', data.token);
        sessionStorage.setItem('user', JSON.stringify(data.user));

        // Redirect to main board
        window.location.href = '/Ticketing.html';
    } catch (err) {
        showError('loginError', 'Cannot connect to server. Make sure the server is running on port 3000.');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Log In';
    }
}

async function handleRegister(e) {
    e.preventDefault();
    hideError('registerError');
    document.getElementById('registerSuccess').style.display = 'none';

    const full_name = document.getElementById('regName').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    const btn = document.getElementById('registerBtn');

    if (password.length < 8) {
        showError('registerError', 'Password must be at least 8 characters.');
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating account...';

    try {
        const res = await fetch(`${API}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ full_name, email, password })
        });

        const data = await res.json();

        if (!res.ok) {
            const msg = data.errors ? data.errors.map(e => e.msg).join(', ') : (data.error || 'Registration failed.');
            showError('registerError', msg);
            return;
        }

        showSuccess('registerSuccess', `Account created! Logging you in as ${data.user.full_name}...`);

        sessionStorage.setItem('token', data.token);
        sessionStorage.setItem('user', JSON.stringify(data.user));

        setTimeout(() => { window.location.href = '/Ticketing.html'; }, 1000);
    } catch (err) {
        showError('registerError', 'Cannot connect to server. Make sure the server is running on port 3000.');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-user-plus"></i> Create Account';
    }
}
