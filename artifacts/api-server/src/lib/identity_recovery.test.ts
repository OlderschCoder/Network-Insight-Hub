import { afterEach, describe, expect, it } from "vitest";
import {
  canPrepareIdentityRecovery,
  signIdentityRecoveryRequest,
  validateIdentityRecoveryInput,
  type IdentityRecoveryInput,
} from "./identity_recovery";

const originalAllowedRoles = process.env.IDENTITY_RECOVERY_ALLOWED_ROLES;

const validInput: IdentityRecoveryInput = {
  legalFirstName: "Ada",
  legalLastName: "Lovelace",
  studentId: "800123456",
  username: "ada.lovelace",
  zendeskTicketId: 7559,
  verificationMethod: "callback_to_number_on_file",
  identityVerified: true,
  confirmed: true,
};

afterEach(() => {
  if (originalAllowedRoles === undefined) {
    delete process.env.IDENTITY_RECOVERY_ALLOWED_ROLES;
  } else {
    process.env.IDENTITY_RECOVERY_ALLOWED_ROLES = originalAllowedRoles;
  }
});

describe("identity recovery guardrails", () => {
  it("allows configured CIO and help-desk roles only", () => {
    delete process.env.IDENTITY_RECOVERY_ALLOWED_ROLES;
    expect(canPrepareIdentityRecovery({ id: 1, role: "cio" })).toBe(true);
    expect(canPrepareIdentityRecovery({ id: 2, role: "helpdesk" })).toBe(true);
    expect(canPrepareIdentityRecovery({ id: 3, role: "viewer" })).toBe(false);
    expect(canPrepareIdentityRecovery({ id: null, role: "cio" })).toBe(false);
  });

  it("requires an exact student number, independent verification, and confirmation", () => {
    expect(validateIdentityRecoveryInput(validInput)).toBeNull();
    expect(
      validateIdentityRecoveryInput({ ...validInput, studentId: "123456789" }),
    ).toContain("beginning with 800");
    expect(
      validateIdentityRecoveryInput({ ...validInput, identityVerified: false }),
    ).toContain("Independent identity verification");
    expect(
      validateIdentityRecoveryInput({ ...validInput, confirmed: false }),
    ).toContain("Confirmation required");
  });

  it("signs the timestamp, nonce, and exact body", () => {
    const signature = signIdentityRecoveryRequest(
      "0123456789abcdef0123456789abcdef",
      "1726243200",
      "abcdef0123456789abcdef0123456789",
      '{"ticket":7559}',
    );
    expect(signature).toHaveLength(64);
    expect(signature).not.toBe(
      signIdentityRecoveryRequest(
        "0123456789abcdef0123456789abcdef",
        "1726243200",
        "abcdef0123456789abcdef0123456789",
        '{"ticket":7560}',
      ),
    );
  });
});
