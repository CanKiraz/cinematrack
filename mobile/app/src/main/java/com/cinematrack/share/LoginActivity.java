package com.cinematrack.share;

import android.content.Intent;
import android.os.Bundle;
import android.util.Patterns;
import android.view.View;
import android.widget.EditText;
import android.widget.ProgressBar;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;
import com.google.firebase.FirebaseNetworkException;
import com.google.firebase.FirebaseTooManyRequestsException;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseAuthException;
import com.google.firebase.auth.FirebaseAuthInvalidCredentialsException;
import com.google.firebase.auth.FirebaseAuthInvalidUserException;
import com.google.firebase.auth.FirebaseAuthUserCollisionException;
import com.google.firebase.auth.FirebaseAuthWeakPasswordException;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.auth.UserProfileChangeRequest;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Sign in / create account / reset password, plus the two "you are signed in but not done yet" states:
 * verify your email (new accounts), and upgrade the old fake address (accounts from before real emails).
 * The rest of the app only accepts a signed-in user whose email is verified (see {@link #isReady}).
 */
public class LoginActivity extends AppCompatActivity {

    private enum Mode { LOGIN, REGISTER, RESET, VERIFY, UPGRADE, UPGRADE_SENT }

    static final int MIN_PASSWORD = 8;
    private static final Pattern DISPLAY_NAME = Pattern.compile("^[A-Za-z0-9_.-]{2,20}$");
    /** Before real emails, accounts were username@cinematrack.local. Those people can still type just the username. */
    private static final String LEGACY_DOMAIN = "@cinematrack.local";

    private FirebaseAuth auth;
    private Mode mode = Mode.LOGIN;
    private String sentTo = "";

    private TextView tvTitle, tvBody, tvEmailLabel, tvError, tvInfo, btnSecondary, btnTertiary;
    private EditText etEmail, etDisplayName, etPassword;
    private View groupName, groupPassword;
    private androidx.appcompat.widget.AppCompatButton btnPrimary;
    private ProgressBar progressBar;

    /** Signed in with a confirmed email: the only state the Firestore rules (and so the app) accept. */
    static boolean isReady(FirebaseUser user) {
        return user != null && user.isEmailVerified();
    }

    static boolean isLegacy(FirebaseUser user) {
        String email = user == null ? null : user.getEmail();
        return email != null && email.toLowerCase(Locale.ROOT).endsWith(LEGACY_DOMAIN);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        auth = FirebaseAuth.getInstance();

        FirebaseUser user = auth.getCurrentUser();
        if (isReady(user)) {
            goToMain();
            return;
        }

        setContentView(R.layout.activity_login);
        tvTitle       = findViewById(R.id.tvTitle);
        tvBody        = findViewById(R.id.tvBody);
        tvEmailLabel  = findViewById(R.id.tvEmailLabel);
        tvError       = findViewById(R.id.tvError);
        tvInfo        = findViewById(R.id.tvInfo);
        etEmail       = findViewById(R.id.etEmail);
        etDisplayName = findViewById(R.id.etDisplayName);
        etPassword    = findViewById(R.id.etPassword);
        groupName     = findViewById(R.id.groupName);
        groupPassword = findViewById(R.id.groupPassword);
        btnPrimary    = findViewById(R.id.btnLogin);
        btnSecondary  = findViewById(R.id.btnSecondary);
        btnTertiary   = findViewById(R.id.btnTertiary);
        progressBar   = findViewById(R.id.progressBar);

        btnPrimary.setOnClickListener(v -> onPrimary());
        btnSecondary.setOnClickListener(v -> onSecondary());
        btnTertiary.setOnClickListener(v -> onTertiary());

        if (user == null) {
            setMode(Mode.LOGIN);
        } else {
            setMode(isLegacy(user) ? Mode.UPGRADE : Mode.VERIFY);
            refreshAccount();
        }
    }

    // ── Modes ─────────────────────────────────────────────────────────────────

    private void setMode(Mode m) {
        mode = m;
        tvError.setVisibility(View.GONE);
        tvInfo.setVisibility(View.GONE);

        boolean emailField = m == Mode.LOGIN || m == Mode.REGISTER || m == Mode.RESET || m == Mode.UPGRADE;
        tvEmailLabel.setVisibility(emailField ? View.VISIBLE : View.GONE);
        etEmail.setVisibility(emailField ? View.VISIBLE : View.GONE);
        tvEmailLabel.setText(m == Mode.LOGIN ? R.string.login_email_label_or_username : R.string.login_email_label);
        groupName.setVisibility(m == Mode.REGISTER ? View.VISIBLE : View.GONE);
        groupPassword.setVisibility(m == Mode.LOGIN || m == Mode.REGISTER ? View.VISIBLE : View.GONE);
        etPassword.setHint(m == Mode.REGISTER ? getString(R.string.login_password_hint_new, MIN_PASSWORD)
                                              : getString(R.string.login_password_hint));

        String body = null;
        switch (m) {
            case LOGIN:
                tvTitle.setText(R.string.sign_in);
                btnPrimary.setText(R.string.sign_in);
                btnSecondary.setText(R.string.login_forgot);
                btnTertiary.setText(R.string.login_create_account);
                break;
            case REGISTER:
                tvTitle.setText(R.string.login_create_account);
                btnPrimary.setText(R.string.login_create_account);
                btnTertiary.setText(R.string.login_back_to_sign_in);
                break;
            case RESET:
                tvTitle.setText(R.string.login_reset_title);
                btnPrimary.setText(R.string.login_reset_send);
                btnTertiary.setText(R.string.login_back_to_sign_in);
                break;
            case VERIFY:
                tvTitle.setText(R.string.login_verify_title);
                FirebaseUser u = auth.getCurrentUser();
                body = getString(R.string.login_verify_body, u == null || u.getEmail() == null ? "" : u.getEmail());
                btnPrimary.setText(R.string.login_verified_button);
                btnSecondary.setText(R.string.login_resend);
                btnTertiary.setText(R.string.sign_out);
                break;
            case UPGRADE:
                tvTitle.setText(R.string.login_upgrade_title);
                body = getString(R.string.login_upgrade_body);
                btnPrimary.setText(R.string.login_upgrade_send);
                btnTertiary.setText(R.string.sign_out);
                break;
            case UPGRADE_SENT:
                tvTitle.setText(R.string.login_upgrade_title);
                body = getString(R.string.login_upgrade_sent, sentTo);
                btnPrimary.setText(R.string.sign_out);
                break;
        }
        tvBody.setText(body);
        tvBody.setVisibility(body == null ? View.GONE : View.VISIBLE);
        btnSecondary.setVisibility(m == Mode.LOGIN || m == Mode.VERIFY ? View.VISIBLE : View.GONE);
        btnTertiary.setVisibility(m == Mode.UPGRADE_SENT ? View.GONE : View.VISIBLE);
    }

    private void onPrimary() {
        switch (mode) {
            case LOGIN:        doLogin(); break;
            case REGISTER:     doRegister(); break;
            case RESET:        doReset(); break;
            case VERIFY:       doCheckVerified(); break;
            case UPGRADE:      doUpgrade(); break;
            case UPGRADE_SENT: signOutToLogin(); break;
        }
    }

    private void onSecondary() {
        if (mode == Mode.LOGIN) setMode(Mode.RESET);
        else if (mode == Mode.VERIFY) doResend();
    }

    private void onTertiary() {
        switch (mode) {
            case LOGIN:    setMode(Mode.REGISTER); break;
            case REGISTER:
            case RESET:    setMode(Mode.LOGIN); break;
            default:       signOutToLogin();   // VERIFY, UPGRADE
        }
    }

    // ── Actions ───────────────────────────────────────────────────────────────

    private void doLogin() {
        String id = text(etEmail);
        String password = etPassword.getText().toString();
        if (id.isEmpty() || password.isEmpty()) { showError(getString(R.string.login_empty_fields)); return; }

        String email = id.contains("@") ? id : id.toLowerCase(Locale.ROOT) + LEGACY_DOMAIN;
        busy(true);
        auth.signInWithEmailAndPassword(email, password)
            .addOnSuccessListener(r -> {
                busy(false);
                FirebaseUser user = r.getUser();
                if (isReady(user)) goToMain();
                else setMode(isLegacy(user) ? Mode.UPGRADE : Mode.VERIFY);
            })
            .addOnFailureListener(e -> { busy(false); showError(describe(e)); });
    }

    private void doRegister() {
        String email = text(etEmail);
        String name = text(etDisplayName);
        String password = etPassword.getText().toString();
        if (email.isEmpty() || name.isEmpty() || password.isEmpty()) { showError(getString(R.string.login_empty_fields)); return; }
        if (!Patterns.EMAIL_ADDRESS.matcher(email).matches()) { showError(getString(R.string.login_invalid_email)); return; }
        if (!DISPLAY_NAME.matcher(name).matches()) { showError(getString(R.string.login_invalid_name)); return; }
        if (password.length() < MIN_PASSWORD) { showError(getString(R.string.login_weak_password, MIN_PASSWORD)); return; }

        busy(true);
        auth.createUserWithEmailAndPassword(email, password)
            .addOnSuccessListener(r -> {
                FirebaseUser user = r.getUser();
                UserProfileChangeRequest profile = new UserProfileChangeRequest.Builder().setDisplayName(name).build();
                user.updateProfile(profile).addOnCompleteListener(t1 ->
                    user.sendEmailVerification().addOnCompleteListener(t2 -> {
                        busy(false);
                        setMode(Mode.VERIFY);   // if the mail failed to send, "Resend email" is right there
                    }));
            })
            .addOnFailureListener(e -> { busy(false); showError(describe(e)); });
    }

    private void doReset() {
        String email = text(etEmail);
        if (!Patterns.EMAIL_ADDRESS.matcher(email).matches()) { showError(getString(R.string.login_invalid_email)); return; }
        busy(true);
        auth.sendPasswordResetEmail(email).addOnCompleteListener(task -> {
            busy(false);
            Exception e = task.getException();
            // Same answer whether or not the account exists, so this cannot be used to probe for accounts
            if (task.isSuccessful() || e instanceof FirebaseAuthInvalidUserException) {
                showInfo(getString(R.string.login_reset_sent, email));
            } else {
                showError(describe(e));
            }
        });
    }

    private void doCheckVerified() {
        FirebaseUser user = auth.getCurrentUser();
        if (user == null) { setMode(Mode.LOGIN); return; }
        busy(true);
        user.reload().addOnCompleteListener(task -> {
            if (!task.isSuccessful()) { busy(false); showError(describe(task.getException())); return; }
            FirebaseUser fresh = auth.getCurrentUser();
            if (isReady(fresh)) {
                // refresh the token so the Firestore rules see email_verified = true
                fresh.getIdToken(true).addOnCompleteListener(t -> { busy(false); goToMain(); });
            } else {
                busy(false);
                showError(getString(R.string.login_not_verified));
            }
        });
    }

    private void doResend() {
        FirebaseUser user = auth.getCurrentUser();
        if (user == null) return;
        busy(true);
        user.sendEmailVerification().addOnCompleteListener(task -> {
            busy(false);
            if (task.isSuccessful()) showInfo(getString(R.string.login_email_sent));
            else showError(describe(task.getException()));
        });
    }

    private void doUpgrade() {
        FirebaseUser user = auth.getCurrentUser();
        String email = text(etEmail);
        if (user == null) { setMode(Mode.LOGIN); return; }
        if (!Patterns.EMAIL_ADDRESS.matcher(email).matches()) { showError(getString(R.string.login_invalid_email)); return; }
        busy(true);
        // The address changes only once the person opens the link we send to it
        user.verifyBeforeUpdateEmail(email).addOnCompleteListener(task -> {
            busy(false);
            if (task.isSuccessful()) { sentTo = email; setMode(Mode.UPGRADE_SENT); }
            else showError(describe(task.getException()));
        });
    }

    /**
     * On opening the screen with an account that is signed in but not verified: it may have been verified in the
     * meantime (link opened while the app was closed), or its session may be gone (e.g. the address was just changed).
     */
    private void refreshAccount() {
        FirebaseUser user = auth.getCurrentUser();
        if (user == null) return;
        user.reload().addOnCompleteListener(task -> {
            if (!task.isSuccessful()) {
                Exception e = task.getException();
                if (e instanceof FirebaseAuthInvalidUserException || e instanceof FirebaseAuthInvalidCredentialsException) {
                    auth.signOut();
                    setMode(Mode.LOGIN);
                    showInfo(getString(R.string.login_session_expired));
                }
                return;   // offline etc.: leave the screen as it is
            }
            FirebaseUser fresh = auth.getCurrentUser();
            if (isReady(fresh)) fresh.getIdToken(true).addOnCompleteListener(t -> goToMain());
        });
    }

    private void signOutToLogin() {
        auth.signOut();
        setMode(Mode.LOGIN);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private String describe(Exception e) {
        if (e instanceof FirebaseAuthUserCollisionException) return getString(R.string.login_email_taken);
        if (e instanceof FirebaseAuthWeakPasswordException) return getString(R.string.login_weak_password, MIN_PASSWORD);
        if (e instanceof FirebaseTooManyRequestsException) return getString(R.string.login_too_many);
        if (e instanceof FirebaseNetworkException) return getString(R.string.login_network);
        if (e instanceof FirebaseAuthInvalidUserException || e instanceof FirebaseAuthInvalidCredentialsException) {
            String code = ((FirebaseAuthException) e).getErrorCode();
            return getString("ERROR_INVALID_EMAIL".equals(code) ? R.string.login_invalid_email : R.string.login_wrong);
        }
        return getString(R.string.login_generic_error);
    }

    private static String text(EditText et) { return et.getText().toString().trim(); }

    private void showError(String msg) {
        tvInfo.setVisibility(View.GONE);
        tvError.setText(msg);
        tvError.setVisibility(View.VISIBLE);
    }

    private void showInfo(String msg) {
        tvError.setVisibility(View.GONE);
        tvInfo.setText(msg);
        tvInfo.setVisibility(View.VISIBLE);
    }

    private void busy(boolean on) {
        progressBar.setVisibility(on ? View.VISIBLE : View.GONE);
        btnPrimary.setEnabled(!on);
        if (on) { tvError.setVisibility(View.GONE); tvInfo.setVisibility(View.GONE); }
    }

    private void goToMain() {
        startActivity(new Intent(this, MainActivity.class));
        finish();
    }
}
