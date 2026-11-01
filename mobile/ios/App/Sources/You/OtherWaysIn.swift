import Account
import DesignSystem
import PaddleAPI
import SwiftUI

/// Below the email form, as the website's /signin: Google when the server
/// offers it (`GET /att/api/auth/options`); on the Sign in tab, always, an
/// email for someone who made their account with Strava, which has gone (not
/// a public issue report: they'd put their name and email in it); and if
/// asking failed, Try again.
struct OtherWaysIn: View {
    let options: SignInOptions
    /// The Sign in tab: the line for an account made with Strava shows.
    let signingIn: Bool
    /// Asking failed and nothing was known before.
    let failed: Bool
    let busy: Bool
    let google: () -> Void
    let tryAgain: () -> Void
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(spacing: 12) {
            if options.google {
                Divider().overlay(Palette.border)
                Text("Or use your Google account")
                    .font(.plexSans(.body))
                    .foregroundStyle(Palette.muted)
                    .multilineTextAlignment(.center)
                GoogleButton(action: google).disabled(busy)
            }
            if failed {
                Divider().overlay(Palette.border)
                muted("Couldn’t load the other ways to sign in.").accessibilityIdentifier("ways-in-failed")
                bordered("Try again", id: "ways-in-try-again", hint: nil, action: tryAgain).disabled(busy)
            }
            if signingIn {
                Divider().overlay(Palette.border).padding(.top, options.google ? 12 : 0)
                muted(SignInHelp.madeWithStrava).accessibilityIdentifier("made-with-strava")
                bordered("Email us", id: "email-us", hint: "Opens Mail") { openURL(SignInHelp.emailUs) }
            }
        }
        .frame(maxWidth: .infinity)
    }

    private func bordered(_ title: String, id: String, hint: String?, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            // On the label: the whole 44 pt is the button.
            Text(title).frame(minHeight: 44)
        }
        .buttonStyle(.bordered)
        .tint(Palette.primaryText)
        .accessibilityHint(hint ?? "")
        .accessibilityIdentifier(id)
    }

    private func muted(_ words: String) -> some View {
        Text(words)
            .font(.plexSans(.subheadline))
            .foregroundStyle(Palette.muted)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// Google's sign-in button in their dark style, as the website's: the
/// four-colour "G" unaltered, "Sign in with Google", fill #131314, border
/// #8E918F, text #E3E3E3. Their colours, not our tokens
/// (developers.google.com/identity/branding-guidelines).
struct GoogleButton: View {
    let action: () -> Void
    @Environment(\.isEnabled) private var isEnabled

    static let fill = Color(red: 0x13 / 255, green: 0x13 / 255, blue: 0x14 / 255)
    static let border = Color(red: 0x8E / 255, green: 0x91 / 255, blue: 0x8F / 255)
    static let text = Color(red: 0xE3 / 255, green: 0xE3 / 255, blue: 0xE3 / 255)

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image("GoogleG").resizable().frame(width: 20, height: 20).accessibilityHidden(true)
                Text("Sign in with Google").font(.plexSans(.body, weight: .medium))
                    .foregroundStyle(Self.text)
            }
            .padding(.horizontal, 16)
            .frame(minHeight: 44)
            .background(Self.fill, in: RoundedRectangle(cornerRadius: Radius.control))
            .overlay(RoundedRectangle(cornerRadius: Radius.control).stroke(Self.border))
        }
        .buttonStyle(.plain)
        // Its colours are Google's, so disabled doesn't dim it by itself.
        .opacity(isEnabled ? 1 : 0.5)
        .accessibilityIdentifier("google-sign-in")
    }
}
