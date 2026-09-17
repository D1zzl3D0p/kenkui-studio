# WorkOS AuthKit branding

The hosted sign-in screen is styled in WorkOS, separately from Studio's CSS.
Apply these settings in **WorkOS Dashboard → Branding** for the appropriate
Kenkui environment. These values match `src/studio/style.css`.

| Setting | Light | Dark |
| --- | --- | --- |
| Page background | `#f5f2ea` | `#25211e` |
| Button background | `#dfbf83` | `#dbb97c` |
| Button text | `#302619` | `#292015` |
| Link color | `#715126` | `#dbb97c` |

- Display name: **Kenkui Studio**.
- Font: **DM Sans**.
- Appearance: **System** (configure both palettes).
- Layout: centered, single column.
- Corner radius: use the closest preset to Studio's 8px controls.
- Sign-in title: **Sign in to your studio**.
- Privacy: `https://kenkui.fm/privacy/`.
- Terms: `https://kenkui.fm/terms/`.

Preview sign-in, email-code, and error states in both appearances before saving.
Branding is scoped to an environment; use WorkOS's copy-branding option to carry
the reviewed settings from staging into production.

Studio's manually selected appearance lives in local storage on the Studio
origin. It does not automatically carry over to the hosted AuthKit origin;
System follows the device preference on both sites.

WorkOS also supports global AuthKit custom CSS if further adjustments are needed.
The built-in color/font settings above avoid coupling to hosted page markup.
These settings have been prepared locally, not applied to a WorkOS environment.

Reference: https://workos.com/docs/authkit/branding
