import Account
import DesignSystem
import SwiftUI

/// "Confirm your email" (#702), as the website's: no tabs, the code with
/// one-time-code autofill, Confirm email, Send a new code, Change email.
struct EmailCodeStepView: View {
    @Bindable var form: SignInForm
    let account: AccountModel
    var focus: FocusState<SignInView.Field?>.Binding
    let signedIn: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            codeIntro
                .font(.plexSans(.body))
                .accessibilityIdentifier("code-explainer")
            if let status = form.status {
                Text(status)
                    .font(.plexSans(.subheadline))
                    .foregroundStyle(Palette.fg)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Palette.surface)
                    .overlay(RoundedRectangle(cornerRadius: Radius.control).stroke(Palette.border))
                    .accessibilityIdentifier("code-status")
            }
            FormField(label: "Code") {
                TextField("000000", text: $form.code)
                    .font(.plexMono(.body))
                    .textContentType(.oneTimeCode)
                    .keyboardType(.numberPad)
                    .focused(focus, equals: .code)
                    .accessibilityIdentifier("code-field")
            }
            if let error = form.error {
                Text(error)
                    .font(.plexSans(.body))
                    .foregroundStyle(Palette.red)
                    .accessibilityIdentifier("sign-in-error")
            }
            Button(action: confirm) {
                Text(form.buttonTitle)
                    .font(.plexSans(.body, weight: .semibold))
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.borderedProminent)
            .tint(Palette.primary)
            .disabled(form.busy || form.resending)
            .accessibilityIdentifier("sign-in-submit")
            // Asks again each second: the 30 seconds between codes.
            TimelineView(.periodic(from: .now, by: 1)) { _ in
                quietButton(form.newCodeTitle, id: "send-new-code") {
                    Task {
                        if await form.sendNewCode(to: account) {
                            signedIn()
                        } else if form.error == nil {
                            focus.wrappedValue = .code
                        }
                    }
                }
                .disabled(form.busy || form.resending || !form.canSendNewCode)
            }
            quietButton("Change email", id: "change-email") {
                form.changeEmail()
                focus.wrappedValue = .email
            }
            .disabled(form.busy || form.resending)
        }
        .onAppear {
            focus.wrappedValue = .code
            // Opened by a sign-in whose code was never entered: say so.
            if let status = form.status { AccessibilityNotification.Announcement(status).post() }
        }
        .onChange(of: form.status) { _, status in
            if let status { AccessibilityNotification.Announcement(status).post() }
        }
        .onChange(of: form.error) { _, error in
            if let error { AccessibilityNotification.Announcement(error).post() }
        }
    }

    /// The email stands out, so a typo in it shows.
    private var codeIntro: Text {
        Text("We’ve emailed a 6-digit code to ").foregroundStyle(Palette.muted)
            + Text(form.email).foregroundStyle(Palette.fg).fontWeight(.semibold)
            + Text(" to check the address is yours. It can take a minute; look in spam if it doesn’t arrive.")
            .foregroundStyle(Palette.muted)
    }

    /// Full width and quiet, as the website's and Android's.
    private func quietButton(_ title: String, id: String, run: @escaping () -> Void) -> some View {
        Button(action: run) {
            Text(title)
                .font(.plexSans(.body))
                .frame(maxWidth: .infinity, minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(Palette.primaryText)
        .accessibilityIdentifier(id)
    }

    private func confirm() {
        focus.wrappedValue = nil
        Task {
            if await form.submit(to: account) {
                signedIn()
            } else if form.step != .form {
                // Still on the code: back to it, so VoiceOver isn't left nowhere.
                focus.wrappedValue = .code
            } else {
                // Confirmed but not signed in: back on Sign in, at the password.
                focus.wrappedValue = .password
            }
        }
    }
}
