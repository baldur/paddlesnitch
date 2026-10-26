import DesignSystem
import PaddleAPI
import SwiftUI

/// Below the email form, as the website's /signin: Google and Strava when the
/// server offers them (`GET /att/api/auth/options`), and with Strava off, a
/// way for someone who signed up with Strava to ask for help.
struct OtherWaysIn: View {
    let options: SignInOptions
    /// The server said Strava is off, so say so (not when it's unknown).
    let stravaSaidOff: Bool
    let busy: Bool
    let google: () -> Void
    let strava: () -> Void
    let report: () -> Void

    static let stravaOff =
        "Signed up with Strava? Strava sign-in is off for now. Report an issue and we’ll help you sign in."

    var body: some View {
        VStack(spacing: 12) {
            if options.google || options.strava {
                Divider().overlay(Palette.border)
                Text(
                    options.google && options.strava
                        ? "Or use your Google or Strava account"
                        : options.google ? "Or use your Google account" : "Or use your Strava account"
                )
                .font(.plexSans(.body))
                .foregroundStyle(Palette.muted)
                .multilineTextAlignment(.center)
                if options.google { GoogleButton(action: google).disabled(busy) }
                if options.strava { stravaButton }
            }
            if stravaSaidOff {
                Divider().overlay(Palette.border)
                muted(Self.stravaOff)
                Button("Report an issue", action: report)
                    .buttonStyle(.bordered)
                    .tint(Palette.primaryText)
                    .frame(minHeight: 44)
                    .accessibilityHint("Opens paddlesnitch.com")
                    .accessibilityIdentifier("report-issue")
            }
        }
        .frame(maxWidth: .infinity)
    }

    /// Strava's own button, unaltered (their brand guidelines).
    @ViewBuilder private var stravaButton: some View {
        Button(action: strava) {
            Image("ConnectWithStrava").resizable().scaledToFit().frame(height: 48)
        }
        .buttonStyle(.plain)
        .disabled(busy)
        .accessibilityLabel("Connect with Strava")
        .accessibilityIdentifier("strava-sign-in")
        muted("Already have an account? Sign in first, then connect Strava in Account.")
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
/// #8E918F, text #E3E3E3. Their colours, not our tokens, as Strava's button
/// keeps Strava's (developers.google.com/identity/branding-guidelines).
struct GoogleButton: View {
    let action: () -> Void

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
        .accessibilityIdentifier("google-sign-in")
    }
}

/// The website's issue form, which opens by itself on a page with
/// `?report=1`: for whoever can't sign in, so it needs no account.
enum ReportIssue {
    static var url: URL {
        PaddlesnitchApp.baseURL.appending(path: "signin").appending(queryItems: [
            URLQueryItem(name: "report", value: "1")
        ])
    }
}
