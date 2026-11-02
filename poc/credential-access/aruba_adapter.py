"""One-account AOS-CX pilot. No account creation/deletion, SNMP, VLAN, or port changes."""
from pathlib import Path
import re
import paramiko
from netmiko import ConnectHandler
from broker import AccessError

ERROR = re.compile(r"(?im)^\s*(?:%\s*)?(?:error|invalid input|incomplete command|permission denied|not authorized|unknown command|operation failed|failed to)")


class ArubaAdapter:
    def __init__(self, jump_host, jump_user, jump_password, known_hosts):
        self.jump_host, self.jump_user = jump_host, jump_user
        self.jump_password, self.known_hosts = jump_password, str(known_hosts)

    def connect(self, target, password):
        if target.get("platform") != "aruba_aoscx" or target["ip"] != "192.168.252.173":
            raise AccessError("Live POC is restricted to the approved AA151-CIO pilot")
        jump = paramiko.SSHClient()
        jump.load_host_keys(self.known_hosts)
        jump.set_missing_host_key_policy(paramiko.RejectPolicy())
        try:
            jump.connect(self.jump_host, username=self.jump_user, password=self.jump_password,
                         timeout=12, auth_timeout=12, banner_timeout=12,
                         allow_agent=False, look_for_keys=False)
            sock = jump.get_transport().open_channel("direct-tcpip", (target["ip"], 22), ("127.0.0.1", 0), timeout=15)
            connection = ConnectHandler(device_type="aruba_aoscx", host=target["ip"],
                username=target["account"], password=password, sock=sock,
                ssh_strict=True, alt_host_keys=True, alt_key_file=self.known_hosts,
                conn_timeout=15, auth_timeout=15, banner_timeout=15,
                fast_cli=False, session_log=None)
            return jump, connection
        except Exception:
            jump.close()
            raise AccessError("Pilot login or trusted management route failed") from None

    def privilege(self, connection, target):
        output = connection.send_command("show user-list", read_timeout=30)
        # Require a real admin account in the administrators group before changing it.
        account = re.escape(target["account"])
        if not re.search(rf"(?im)^\s*{account}\s+administrators\b", output):
            raise AccessError("Pilot account administrator membership was not verified")

    def verify(self, target, password):
        jump, connection = self.connect(target, password)
        try:
            self.privilege(connection, target)
        finally:
            connection.disconnect()
            jump.close()

    @staticmethod
    def set_password(connection, target, password):
        if target["account"] != "admin":
            raise AccessError("Pilot only rotates the existing admin account")
        connection.config_mode()
        try:
            output = connection.send_command("user admin password",
                expect_string=r"(?i)(?:enter|new).*password\s*:", read_timeout=30,
                cmd_verify=False, strip_command=False, strip_prompt=False)
            output += connection.send_command(password,
                expect_string=r"(?i)(?:confirm|re-?enter|again).*password\s*:", read_timeout=30,
                cmd_verify=False, strip_command=False, strip_prompt=False)
            output += connection.send_command(password, expect_string=r"[#>]\s*$",
                read_timeout=30, cmd_verify=False, strip_command=False, strip_prompt=False)
            if ERROR.search(output):
                raise AccessError("Pilot rejected the new password")
        except Exception:
            connection.write_channel("\x03")
            raise
        finally:
            connection.exit_config_mode()

    def change(self, target, old, new):
        jump, original = self.connect(target, old)
        try:
            self.privilege(original, target)
            before = original.send_command("show running-config", read_timeout=60)
            # A backup callback persists this encrypted in the vault before mutation.
            if not callable(getattr(self, "backup", None)):
                raise AccessError("Encrypted configuration backup callback missing")
            self.backup(before)
            try:
                self.set_password(original, target, new)
                self.verify(target, new)
                saved = str(original.save_config())
                if ERROR.search(saved) or not re.search(r"(?i)success|complete|saved|done", saved):
                    raise AccessError("Configuration save was not confirmed")
                self.verify(target, new)
            except Exception:
                try:
                    self.set_password(original, target, old)
                    saved = str(original.save_config())
                    if ERROR.search(saved):
                        raise AccessError("Rollback save rejected")
                    self.verify(target, old)
                except Exception:
                    raise AccessError("Rotation and rollback need manual recovery review") from None
                raise AccessError("Rotation failed; prior login restored and verified") from None
        finally:
            original.disconnect()
            jump.close()
