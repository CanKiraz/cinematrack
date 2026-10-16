package com.cinematrack.share;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.auth.UserProfileChangeRequest;
import java.util.concurrent.Executors;

/** The settings gear in the top bar: who you are signed in as, change display name, sign out, delete account. */
final class AccountDialog {
    private AccountDialog() {}

    static void show(Activity activity) {
        FirebaseUser user = FirebaseAuth.getInstance().getCurrentUser();
        if (user == null) return;

        View view = LayoutInflater.from(activity).inflate(R.layout.dialog_account, null);
        ((TextView) view.findViewById(R.id.tvAccountName)).setText(FirestoreHelper.username(user));
        ((TextView) view.findViewById(R.id.tvAccountEmail)).setText(user.getEmail());

        AlertDialog dialog = new AlertDialog.Builder(activity).setView(view).create();
        view.findViewById(R.id.btnChangeName).setOnClickListener(v -> { dialog.dismiss(); changeName(activity); });
        view.findViewById(R.id.btnAccountSignOut).setOnClickListener(v -> { dialog.dismiss(); confirmSignOut(activity); });
        view.findViewById(R.id.btnAccountDelete).setOnClickListener(v -> { dialog.dismiss(); confirmDelete(activity); });
        dialog.show();
    }

    private static int dp(Context c, int v) { return (int) (v * c.getResources().getDisplayMetrics().density); }

    private static FrameLayout boxed(Context c, EditText field) {
        FrameLayout box = new FrameLayout(c);
        box.setPadding(dp(c, 20), dp(c, 8), dp(c, 20), 0);
        box.addView(field);
        return box;
    }

    // --- change display name ---

    private static void changeName(Activity activity) {
        FirebaseUser user = FirebaseAuth.getInstance().getCurrentUser();
        if (user == null) return;
        final EditText input = new EditText(activity);
        input.setText(FirestoreHelper.username(user));
        input.setSelection(input.getText().length());
        input.setSingleLine(true);
        input.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(20)});

        new AlertDialog.Builder(activity)
            .setTitle(R.string.account_name_title)
            .setView(boxed(activity, input))
            .setPositiveButton(R.string.save, (d, w) -> saveName(activity, input.getText().toString().trim()))
            .setNegativeButton(R.string.cancel, null).show();
    }

    private static void saveName(Activity activity, String name) {
        FirebaseUser user = FirebaseAuth.getInstance().getCurrentUser();
        if (user == null || name.equals(FirestoreHelper.username(user))) return;
        Context app = activity.getApplicationContext();
        Handler main = new Handler(Looper.getMainLooper());
        Executors.newSingleThreadExecutor().execute(() -> {
            NameCheck.Verdict verdict = NameCheck.check(name);
            if (verdict != NameCheck.Verdict.OK) {
                main.post(() -> Toast.makeText(app, NameCheck.message(verdict), Toast.LENGTH_LONG).show());
                return;
            }
            user.updateProfile(new UserProfileChangeRequest.Builder().setDisplayName(name).build())
                .addOnSuccessListener(x -> Toast.makeText(app, R.string.name_updated, Toast.LENGTH_SHORT).show())
                .addOnFailureListener(e -> Toast.makeText(app, R.string.login_generic_error, Toast.LENGTH_LONG).show());
        });
    }

    // --- sign out ---

    private static void confirmSignOut(Activity activity) {
        new AlertDialog.Builder(activity)
            .setTitle(R.string.sign_out_title)
            .setMessage(R.string.sign_out_message)
            .setPositiveButton(R.string.sign_out, (d, w) -> signOut(activity))
            .setNegativeButton(R.string.cancel, null).show();
    }

    private static void signOut(Activity activity) {
        FirebaseAuth.getInstance().signOut();
        // Back to the login screen and drop everything else (tabs, listeners, Watch Together session)
        Intent i = new Intent(activity, LoginActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        activity.startActivity(i);
    }

    // --- delete account ---

    private static void confirmDelete(Activity activity) {
        final EditText password = new EditText(activity);
        password.setHint(R.string.delete_account_password_hint);
        password.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);

        new AlertDialog.Builder(activity)
            .setTitle(R.string.delete_account_title)
            .setMessage(R.string.delete_account_message)
            .setView(boxed(activity, password))
            .setPositiveButton(R.string.delete_account_confirm, (d, w) -> {
                String typed = password.getText().toString();
                if (!typed.isEmpty()) deleteAccount(activity, typed);
            })
            .setNegativeButton(R.string.cancel, null).show();
    }

    private static void deleteAccount(Activity activity, String password) {
        Context ctx = activity.getApplicationContext();
        Toast.makeText(ctx, R.string.delete_account_working, Toast.LENGTH_SHORT).show();
        Handler main = new Handler(Looper.getMainLooper());
        AccountDeletion.run(password, new AccountDeletion.Callback() {
            @Override public void onDone() {
                main.post(() -> {
                    Toast.makeText(ctx, R.string.delete_account_done, Toast.LENGTH_LONG).show();
                    // the account is gone: back to the login screen and drop everything else
                    Intent i = new Intent(ctx, LoginActivity.class);
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
                    ctx.startActivity(i);
                });
            }
            @Override public void onFailed(AccountDeletion.Failure why) {
                int msg;
                switch (why) {
                    case WRONG_PASSWORD: msg = R.string.delete_account_wrong_password; break;
                    case TOO_MANY:       msg = R.string.login_too_many; break;
                    case NETWORK:        msg = R.string.login_network; break;
                    default:             msg = R.string.delete_account_failed;
                }
                main.post(() -> Toast.makeText(ctx, msg, Toast.LENGTH_LONG).show());
            }
        });
    }
}
