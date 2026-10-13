# Pipeline manual testing

## Supabase foundation and authentication

- [ ] Run the initial SQL migration successfully.
- [ ] Confirm all application tables exist and have Row Level Security enabled.
- [ ] Confirm the `profile-photos` bucket is private.
- [ ] Create an account with a unique username.
- [ ] Confirm the email and log in.
- [ ] Refresh the page and confirm the session remains active.
- [ ] Log out and confirm the authentication screen returns.
- [ ] Try an invalid password and confirm a useful error appears.
- [ ] Try a duplicate username and confirm the request is rejected.
- [ ] Request a password reset email.
- [ ] Register a second account and confirm both accounts have different profile IDs.
- [ ] Confirm `public_profiles` does not expose private profile fields.
- [ ] Confirm a user cannot insert a verified group membership for themselves.
- [ ] Confirm an acquaintance request starts pending and cannot be confirmed by the requester alone.

## Demo mode

- [ ] Omit `supabase-config.js`.
- [ ] Confirm the existing prototype can still be entered through the explicit demo-mode button.
- [ ] Confirm demo people, messages, and sample opportunities remain labeled as demo data.

## Pipeline Beta 1.1 Onboarding Flow

- [ ] Log in with a newly confirmed account (`onboarding_completed_at` is null).
- [ ] Verify the "Set up your profile" modal displays and cannot be dismissed without completing setup.
- [ ] Verify that attempting to navigate to "Surf the Grid" or click follow buttons prompts to complete profile setup.
- [ ] Confirm Step 1 requires full name, headline, school, major, and graduation year before continuing.
- [ ] Test Step 2 by selecting interest chips and choosing communities/groups to join.
- [ ] Test Step 3 by entering skills manually or uploading a resume file.
- [ ] Submit the onboarding form and verify that `profiles` table in Supabase has updated with `onboarding_completed_at` populated.
- [ ] Verify that new accounts start with zero inherited demo groups, follows, and acquaintances (other than what was chosen during onboarding).
- [ ] Verify that returning users with an already completed onboarding flow bypass the onboarding modal and retain their saved profile fields.
- [ ] Open the profile editor from the Profile tab and update major or graduation year; verify the edits sync to Supabase and update the profile view.

