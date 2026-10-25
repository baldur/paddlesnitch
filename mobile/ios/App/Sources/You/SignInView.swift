import Account
import AuthenticationServices
import DesignSystem
import SampleServer
import SwiftUI

/// Sign in or create an account: the same fields, checks and words as the
/// Android app and the website's /signin: password sign-in, sign-up and
/// Strava. The email code waits for email delivery, as on the website.
struct SignInView: View {
    let account: AccountModel
    @State private var form = SignInForm()
    @State private var web: URL?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession
    @FocusState private var focus: Field?

    enum Field: Hashable {
        case email, name, password
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Picker("Sign in or create an account", selection: $form.mode) {
                        Text("Sign in").tag(SignInForm.Mode.signIn)
                        Text("Create account").tag(SignInForm.Mode.createAccount)
                    }
                    .pickerStyle(.segmented)

                    field("Email") {
                        TextField("", text: $form.email)
                            .textContentType(.username)
                            .keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .focused($focus, equals: .email)
                            .submitLabel(.next)
                            .onSubmit { focus = form.mode == .createAccount ? .name : .password }
                    }
                    if form.mode == .createAccount {
                        field("Display name", help: SignInForm.displayNameHelp) {
                            TextField("", text: $form.displayName)
                                .textContentType(.nickname)
                                .focused($focus, equals: .name)
                                .submitLabel(.next)
                                .onSubmit { focus = .password }
                        }
                    }
                    field("Password", help: form.mode == .createAccount ? SignInForm.passwordRule : nil) {
                        SecureField("", text: $form.password)
                            .textContentType(form.mode == .createAccount ? .newPassword : .password)
                            .focused($focus, equals: .password)
                            .submitLabel(.go)
                            .onSubmit(submit)
                    }
                    if form.mode == .createAccount {
                        terms
                    }
                    if let error = form.error {
                        Text(error)
                            .font(.plexSans(.body))
                            .foregroundStyle(Palette.red)
                            .accessibilityIdentifier("sign-in-error")
                    }
                    Button(action: submit) {
                        Text(form.buttonTitle)
                            .font(.plexSans(.body, weight: .semibold))
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Palette.primary)
                    .disabled(form.busy)
                    .accessibilityIdentifier("sign-in-submit")
                    if form.mode == .signIn {
                        Button("Forgot password?") { web = PaddlesnitchApp.baseURL.appending(path: "signin/forgot") }
                            .font(.plexSans(.body))
                            .foregroundStyle(Palette.primaryText)
                            .frame(minHeight: 44)
                    }
                    strava
                }
                .padding(16)
            }
            .background(Palette.bg)
            .navigationTitle(form.mode == .signIn ? "Sign in" : "Create account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .sheet(item: $web) { url in
                SafariView(url: url).ignoresSafeArea()
            }
        }
        .preferredColorScheme(.dark)
    }

    /// Strava's own button, unaltered (their brand guidelines).
    private var strava: some View {
        VStack(spacing: 12) {
            Divider().overlay(Palette.border)
            Text("Or use your Strava account")
                .font(.plexSans(.body))
                .foregroundStyle(Palette.muted)
            Button(action: signInWithStrava) {
                Image("ConnectWithStrava").resizable().scaledToFit().frame(height: 48)
            }
            .buttonStyle(.plain)
            .disabled(form.busy)
            .accessibilityLabel("Connect with Strava")
            .accessibilityIdentifier("strava-sign-in")
            Text("Already have an account? Sign in first, then connect Strava in Account on paddlesnitch.com.")
                .font(.plexSans(.subheadline))
                .foregroundStyle(Palette.muted)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity)
    }

    private var terms: some View {
        HStack(alignment: .center, spacing: 8) {
            Toggle(isOn: $form.agreedToTerms) {
                Text("I agree to the Terms of Service")
                    .font(.plexSans(.body))
                    .foregroundStyle(Palette.fg)
            }
            .toggleStyle(CheckboxStyle())
            .accessibilityIdentifier("terms-checkbox")
            Spacer()
            Button("Read them") { web = PaddlesnitchApp.baseURL.appending(path: "terms") }
                .font(.plexSans(.body))
                .foregroundStyle(Palette.primaryText)
        }
    }

    private func field<Content: View>(_ label: String, help: String? = nil, @ViewBuilder _ input: () -> Content)
        -> some View
    {
        // A visible label above every input, help below (design-system.md).
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.plexSans(.subheadline, weight: .medium)).foregroundStyle(Palette.fg)
            input()
                .font(.plexSans(.body))
                .padding(.horizontal, 12)
                .frame(minHeight: 44)
                .background(Palette.surface)
                .overlay(RoundedRectangle(cornerRadius: Radius.control).stroke(Palette.borderStrong))
                .accessibilityLabel(label)
            if let help {
                Text(help).font(.plexSans(.subheadline)).foregroundStyle(Palette.muted)
            }
        }
    }

    /// The keyboard goes first, so the sheet isn't still laying out for it
    /// while it closes.
    private func submit() {
        focus = nil
        Task {
            if await form.submit(to: account) { dismiss() }
        }
    }
}

extension SignInView {
    private func signInWithStrava() {
        focus = nil
        Task {
            if await form.signInWithStrava(to: account, browser: openStrava) { dismiss() }
        }
    }

    /// The system's sign-in browser, which shares Safari's cookies: someone
    /// signed in to Strava there needn't sign in again. The sample server
    /// answers at once.
    private func openStrava(_ start: URL) async throws -> URL {
        if PaddlesnitchApp.usesSampleServer { return SampleServer.stravaBrowser(start) }
        do {
            return try await webAuthenticationSession.authenticate(
                using: start, callbackURLScheme: StravaSignIn.callbackScheme, preferredBrowserSession: .shared)
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            throw CancellationError()
        }
    }
}

/// A tick box: iOS has no checkbox, and a switch reads oddly for agreeing.
struct CheckboxStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        Button {
            configuration.isOn.toggle()
        } label: {
            HStack(spacing: 8) {
                Image(systemName: configuration.isOn ? "checkmark.square.fill" : "square")
                    .font(.plexSans(.title3))
                    .foregroundStyle(configuration.isOn ? Palette.primaryText : Palette.muted)
                    .accessibilityHidden(true)
                configuration.label
            }
            .frame(minHeight: 44)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(configuration.isOn ? [.isSelected] : [])
        .accessibilityValue(configuration.isOn ? "Ticked" : "Not ticked")
    }
}

extension URL: @retroactive Identifiable {
    public var id: String { absoluteString }
}
