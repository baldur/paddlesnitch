import Account
import DesignSystem
import SwiftUI

/// Forgot password, as the website's /signin/forgot then /signin/reset, in
/// the sign-in sheet. The code field takes the code from Mail, and the new
/// password field offers the system's strong password.
struct ForgotPasswordView: View {
    let account: AccountModel
    /// Signed in with the new password: close the sign-in sheet.
    let signedIn: () -> Void
    /// The password is set, but sign in with it: back to the form.
    let signInAgain: (_ email: String) -> Void
    @State private var form: ForgotPasswordForm
    @FocusState private var focus: Field?

    enum Field: Hashable {
        case email, code, password
    }

    init(
        account: AccountModel, email: String, signedIn: @escaping () -> Void,
        signInAgain: @escaping (_ email: String) -> Void
    ) {
        self.account = account
        self.signedIn = signedIn
        self.signInAgain = signInAgain
        let form = ForgotPasswordForm()
        form.email = email
        _form = State(initialValue: form)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text(
                    form.step == .email
                        ? "Enter your email and we'll send you a 6-digit code."
                        : "If there's an account for \(form.email), we've sent it a code. "
                            + "Paste the 6-digit code from your email and choose a new password."
                )
                .font(.plexSans(.body))
                .foregroundStyle(Palette.muted)
                .accessibilityIdentifier("forgot-explainer")
                if form.step == .email {
                    FormField(label: "Email") {
                        TextField("", text: $form.email)
                            .textContentType(.username)
                            .keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .focused($focus, equals: .email)
                            .submitLabel(.send)
                            .onSubmit(submit)
                    }
                } else {
                    FormField(label: "Code from the email") {
                        TextField("", text: $form.code)
                            .textContentType(.oneTimeCode)
                            .keyboardType(.numberPad)
                            .focused($focus, equals: .code)
                    }
                    FormField(label: "New password", help: SignInForm.passwordRule) {
                        SecureField("", text: $form.password)
                            .textContentType(PaddlesnitchApp.password(.newPassword))
                            .focused($focus, equals: .password)
                            .submitLabel(.go)
                            .onSubmit(submit)
                    }
                }
                if let error = form.error {
                    Text(error)
                        .font(.plexSans(.body))
                        .foregroundStyle(Palette.red)
                        .accessibilityIdentifier("forgot-error")
                }
                Button(action: submit) {
                    Text(form.buttonTitle)
                        .font(.plexSans(.body, weight: .semibold))
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .tint(Palette.primary)
                .disabled(form.busy)
                .accessibilityIdentifier("forgot-submit")
                if form.step == .code {
                    Button {
                        Task { await form.requestCode(to: account) }
                    } label: {
                        Text("Send a new code").frame(minHeight: 44)
                    }
                    .font(.plexSans(.body))
                    .foregroundStyle(Palette.primaryText)
                    .disabled(form.busy)
                }
            }
            .padding(16)
        }
        .background(Palette.bg)
        .navigationTitle(form.step == .email ? "Reset your password" : "Set a new password")
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: form.step) { _, step in focus = step == .code ? .code : .email }
        .onChange(of: form.error) { _, error in
            if let error { AccessibilityNotification.Announcement(error).post() }
        }
    }

    private func submit() {
        focus = nil
        Task {
            switch form.step {
            case .email:
                await form.requestCode(to: account)
            case .code:
                switch await form.resetPassword(to: account) {
                case .signedIn: signedIn()
                case .signInAgain: signInAgain(form.email)
                case nil: break
                }
            }
        }
    }
}
