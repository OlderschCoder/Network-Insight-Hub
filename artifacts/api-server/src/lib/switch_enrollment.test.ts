import { describe, expect, it } from "vitest";
import { isPrivateIpv4 } from "./switch_enrollment";

describe("switch enrollment address boundary", () => {
  it.each(["10.0.0.22", "172.16.0.1", "172.31.255.254", "192.168.2.195"])("accepts %s", (ip) => {
    expect(isPrivateIpv4(ip)).toBe(true);
  });

  it.each(["8.8.8.8", "172.32.0.1", "127.0.0.1", "not-an-ip", "10.0.0.999"])("rejects %s", (ip) => {
    expect(isPrivateIpv4(ip)).toBe(false);
  });
});
