import Account
import DesignSystem
import SwiftUI

/// Your details and public profile on the Account screen, as the website's
/// /account: the email and name, a contact email for a Strava account, public
/// or private, and the profile handle. The public page itself stays the
/// website's.
struct ProfileSections: View {
    let account: AccountModel
    let form: ProfileForm
    /// Opens a website page: the public profile.
    let open: (_ title: String, _ path: String) -> Void
    @Environment(\.dynamicTypeSize) private var typeSize
    @FocusState private var focus: Field?

    enum Field: Hashable {
        case handle, contact
    }

    /// Side by side; stacked and full width at accessibility sizes, where
    /// "Change" broke into "Chan / ge" beside "Remove" (LargeTextTests).
    private var buttonRow: AnyLayout {
        typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8)) : AnyLayout(HStackLayout(spacing: 12))
    }

    static let publicExplained =
        "Show your race results and personal bests on a public page. Private and group-only results stay hidden. "
        + "Off until you turn it on."
    static let contactHelp =
        "We don’t have an email for this account. Add one so we can move your account to it "
        + "and tell you about changes to our Terms."

    var body: some View {
        Section {
            if let user = account.user {
                // Only once it's known not to be a Strava placeholder.
                if form.loaded && !form.needsContactEmail {
                    detail("Email", user.email)
                }
                detail("Display name", user.displayName)
                // For support: the one id we can look an account up by.
                VStack(alignment: .leading, spacing: 2) {
                    Text("Support ID").font(.plexSans(.subheadline)).foregroundStyle(Palette.muted)
                    Text(user.id).font(.plexMono(.subheadline)).foregroundStyle(Palette.muted).textSelection(.enabled)
                }
                .accessibilityElement(children: .combine)
                .listRowBackground(Palette.surface)
            }
            if form.needsContactEmail { contactEmail }
        } header: {
            header("Your details")
        }
        Section {
            text(Self.publicExplained, muted: true)
            if let failure = form.loadFailure {
                text(failure, failed: true)
                Button("Try again") { Task { await form.load() } }
                    .frame(minHeight: 44)
                    .listRowBackground(Palette.surface)
            } else if form.loaded {
                Button {
                    Task { await form.togglePublic() }
                } label: {
                    Text(form.publicButton).fixedSize(horizontal: false, vertical: true).frame(minHeight: 44)
                }
                .disabled(form.busy != nil)
                .listRowBackground(Palette.surface)
                if let message = form.visibilityMessage {
                    text(message, failed: true)
                        .accessibilityIdentifier("profile-visibility-message")
                        .onAppear { AccessibilityNotification.Announcement(message).post() }
                }
                if let path = form.profilePath {
                    Button {
                        open(form.profileLink, path)
                    } label: {
                        HStack {
                            Text(form.profileLink).foregroundStyle(Palette.primaryText)
                            Spacer()
                            Image(systemName: "arrow.up.right.square").foregroundStyle(Palette.muted)
                                .accessibilityHidden(true)
                        }
                    }
                    .accessibilityHint("Opens paddlesnitch.com")
                    .listRowBackground(Palette.surface)
                }
                handleField
            } else {
                ProgressView("Loading your profile…").tint(Palette.muted).foregroundStyle(Palette.muted)
                    .listRowBackground(Palette.surface)
            }
        } header: {
            header("Public profile")
        }
        .font(.plexSans(.body))
    }

    @ViewBuilder private var handleField: some View {
        @Bindable var form = form
        // Rows of their own, not one tall row: at the largest text size a
        // row taller than the screen leaves the List blank (CLAUDE.md).
        Group {
            VStack(alignment: .leading, spacing: 6) {
                Text("Profile handle").font(.plexSans(.subheadline, weight: .medium)).foregroundStyle(Palette.fg)
                TextField("your-handle", text: $form.handleInput)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding(.horizontal, 12)
                    .frame(minHeight: 44)
                    .background(Palette.bg)
                    .overlay(RoundedRectangle(cornerRadius: Radius.control).stroke(Palette.borderStrong))
                    .accessibilityLabel("Profile handle")
                    .accessibilityIdentifier("profile-handle")
                    .focused($focus, equals: .handle)
                    .submitLabel(.done)
                    .onSubmit { Task { await form.saveHandle() } }
            }
            Text(form.handleHelp).font(.plexSans(.subheadline)).foregroundStyle(Palette.muted)
                .fixedSize(horizontal: false, vertical: true)
            buttonRow {
                Button {
                    focus = nil
                    Task { await form.saveHandle() }
                } label: {
                    Text(form.handleButton).frame(maxWidth: typeSize.isAccessibilitySize ? .infinity : nil)
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .tint(Palette.primaryText)
                .disabled(!form.canSaveHandle)
                .accessibilityIdentifier("profile-handle-save")
                if form.handle != nil {
                    Button {
                        Task { await form.removeHandle() }
                    } label: {
                        Text("Remove").frame(maxWidth: typeSize.isAccessibilitySize ? .infinity : nil, minHeight: 44)
                    }
                    .foregroundStyle(Palette.muted)
                    .disabled(form.busy != nil)
                }
            }
            if let message = form.handleMessage {
                Text(message).font(.plexSans(.subheadline))
                    .foregroundStyle(form.handleFailed ? Palette.red : Palette.muted)
                    .accessibilityIdentifier("profile-handle-message")
            }
        }
        .buttonStyle(.borderless)
        .listRowBackground(Palette.surface)
        .listRowSeparator(.hidden)
        .onChange(of: form.handleMessage) { _, message in
            if let message { AccessibilityNotification.Announcement(message).post() }
        }
    }

    @ViewBuilder private var contactEmail: some View {
        @Bindable var form = form
        // Rows of their own, not one tall row: at the largest text size a
        // row taller than the screen leaves the List blank (CLAUDE.md).
        Group {
            VStack(alignment: .leading, spacing: 6) {
                Text("Contact email").font(.plexSans(.subheadline, weight: .medium)).foregroundStyle(Palette.fg)
                TextField("you@example.com", text: $form.contactInput)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding(.horizontal, 12)
                    .frame(minHeight: 44)
                    .background(Palette.bg)
                    .overlay(RoundedRectangle(cornerRadius: Radius.control).stroke(Palette.borderStrong))
                    .accessibilityLabel("Contact email")
                    .accessibilityIdentifier("contact-email")
                    .focused($focus, equals: .contact)
                    .submitLabel(.done)
                    .onSubmit { Task { await form.saveContact() } }
            }
            Text(Self.contactHelp).font(.plexSans(.subheadline)).foregroundStyle(Palette.muted)
                .fixedSize(horizontal: false, vertical: true)
            buttonRow {
                Button {
                    focus = nil
                    Task { await form.saveContact() }
                } label: {
                    Text(form.contactButton).frame(maxWidth: typeSize.isAccessibilitySize ? .infinity : nil)
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .tint(Palette.primaryText)
                .disabled(form.busy != nil || form.contactInput.trimmingCharacters(in: .whitespaces).isEmpty)
                .accessibilityIdentifier("contact-email-save")
                if form.contactSaved != nil {
                    Button {
                        Task { await form.removeContact() }
                    } label: {
                        Text("Remove").frame(maxWidth: typeSize.isAccessibilitySize ? .infinity : nil, minHeight: 44)
                    }
                    .foregroundStyle(Palette.muted)
                    .disabled(form.busy != nil)
                }
            }
            if let message = form.contactMessage {
                Text(message).font(.plexSans(.subheadline))
                    .foregroundStyle(form.contactFailed ? Palette.red : Palette.muted)
                    .accessibilityIdentifier("contact-email-message")
            }
        }
        .buttonStyle(.borderless)
        .listRowBackground(Palette.surface)
        .listRowSeparator(.hidden)
        .onChange(of: form.contactMessage) { _, message in
            if let message { AccessibilityNotification.Announcement(message).post() }
        }
    }

    private func detail(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.plexSans(.subheadline)).foregroundStyle(Palette.muted)
            Text(value).font(.plexSans(.body)).foregroundStyle(Palette.fg)
        }
        .accessibilityElement(children: .combine)
        .listRowBackground(Palette.surface)
    }

    private func text(_ words: String, muted: Bool = false, failed: Bool = false) -> some View {
        Text(words).font(.plexSans(.subheadline))
            .foregroundStyle(failed ? Palette.red : muted ? Palette.muted : Palette.fg)
            // Its full height: a List row sized short cut long text off
            // at the largest sizes (the audit, iOS 17 and 26).
            .fixedSize(horizontal: false, vertical: true)
            .listRowBackground(Palette.surface)
    }

    private func header(_ words: String) -> some View {
        Text(words).font(.plexSans(.subheadline, weight: .medium)).foregroundStyle(Palette.muted).textCase(nil)
    }
}
