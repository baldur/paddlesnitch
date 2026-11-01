import Foundation
import PaddleAPI
import SampleServer
import Testing

@testable import Account

/// Your details and public profile on the native Account screen, as the
/// website's /account: public or private, the handle, and a contact email
/// for an account made with Strava, whose sign-in email is a placeholder.
@MainActor @Suite struct ProfileFormTests {
    let server = SampleServer(fixtures: fixtures)

    /// `placeholder`: an account made with Strava, signed in from before.
    func signedIn(placeholder: Bool = false) async throws -> AccountModel {
        let suite = "profile-\(UUID().uuidString)"
        let account = AccountModel(
            baseURL: URL(string: "https://paddlesnitch.test") ?? URL(filePath: "/"), transport: server,
            app: "ios/1.0", tokens: MemoryTokenStore(),
            profile: ProfileStore(defaults: { UserDefaults(suiteName: suite) ?? .standard }))
        try await account.signIn(email: "pat@example.com", password: SampleServer.password)
        server.placeholderEmail = placeholder
        return account
    }

    @Test func loadingShowsTheProfileAndNoContactFormForARealEmail() async throws {
        let form = ProfileForm(account: try await signedIn())
        await form.load()
        #expect(form.isPublic == true)
        #expect(form.handle == "river-pat")
        #expect(form.handleInput == "river-pat")
        #expect(!form.needsContactEmail, "a real sign-in email needs no contact email")
    }

    @Test func anAccountMadeWithStravaIsAskedForAContactEmail() async throws {
        let form = ProfileForm(account: try await signedIn(placeholder: true))
        await form.load()
        #expect(form.needsContactEmail)
        #expect(form.contactSaved == nil)
    }

    @Test func makingTheProfilePrivateSaysSoOnTheButton() async throws {
        let form = ProfileForm(account: try await signedIn())
        await form.load()
        #expect(form.publicButton == "Make profile private")
        await form.togglePublic()
        #expect(form.isPublic == false)
        #expect(form.publicButton == "Make profile public")
        #expect(form.profileLink == "Preview my profile")
    }

    @Test func savingAHandleSaysSavedAndChangesTheButton() async throws {
        let form = ProfileForm(account: try await signedIn())
        await form.load()
        #expect(form.handleButton == "Change")
        form.handleInput = "  pat-on-the-thames "
        await form.saveHandle()
        #expect(form.handle == "pat-on-the-thames")
        #expect(form.handleMessage == "Saved.")
        #expect(!form.handleFailed)
    }

    @Test func aTakenHandleSaysWhyInTheServersWords() async throws {
        let form = ProfileForm(account: try await signedIn())
        await form.load()
        form.handleInput = SampleServer.takenHandle
        await form.saveHandle()
        #expect(form.handle == "river-pat", "unchanged")
        #expect(form.handleMessage == "That handle is already taken.")
        #expect(form.handleFailed)
    }

    @Test func removingTheHandleReleasesIt() async throws {
        let form = ProfileForm(account: try await signedIn())
        await form.load()
        await form.removeHandle()
        #expect(form.handle == nil)
        #expect(form.handleInput.isEmpty)
        #expect(form.handleButton == "Save")
        #expect(form.handleMessage == "Handle released.")
    }

    @Test func theSaveButtonWaitsForANewHandle() async throws {
        let form = ProfileForm(account: try await signedIn())
        await form.load()
        #expect(!form.canSaveHandle, "the same handle")
        form.handleInput = " "
        #expect(!form.canSaveHandle)
        form.handleInput = "new-one"
        #expect(form.canSaveHandle)
    }

    @Test func aContactEmailIsSavedThenRemoved() async throws {
        let form = ProfileForm(account: try await signedIn(placeholder: true))
        await form.load()
        #expect(form.contactButton == "Save")
        form.contactInput = " me@example.com "
        await form.saveContact()
        #expect(form.contactSaved == "me@example.com")
        #expect(form.contactMessage == "Saved.")
        #expect(form.contactButton == "Update")
        await form.removeContact()
        #expect(form.contactSaved == nil)
        #expect(form.contactMessage == "Removed.")
    }

    @Test func aBadContactEmailSaysWhy() async throws {
        let form = ProfileForm(account: try await signedIn(placeholder: true))
        await form.load()
        form.contactInput = "not-an-email"
        await form.saveContact()
        #expect(form.contactSaved == nil)
        #expect(form.contactMessage == SampleServer.badEmailMessage)
        #expect(form.contactFailed)
    }

    @Test func aFailedPublicChangeSaysSoUnderItsOwnButtonInTheWebsitesWords() async throws {
        let form = ProfileForm(account: try await signedIn())
        await form.load()
        server.failsProfileChange = true
        await form.togglePublic()
        #expect(form.isPublic == true, "unchanged")
        #expect(form.visibilityMessage == "Couldn't update your profile. Please try again.")
        #expect(form.handleMessage == nil, "not under the handle")
    }

    @Test func theHandleHelpShowsTheSavedHandle() async throws {
        let form = ProfileForm(account: try await signedIn())
        #expect(form.handleHelp.contains("/profile/your-handle"))
        await form.load()
        #expect(form.handleHelp.contains("/profile/river-pat"))
    }

    /// Saving twice must say "Saved." twice, so it's shown and read again.
    @Test func eachSaveStartsWithoutTheLastMessage() async throws {
        let form = ProfileForm(account: try await signedIn())
        await form.load()
        form.handleInput = "first-one"
        await form.saveHandle()
        #expect(form.handleMessage == "Saved.")
        form.handleInput = SampleServer.takenHandle
        let saving = Task { await form.saveHandle() }
        await saving.value
        #expect(form.handleMessage == "That handle is already taken.")
    }
}
