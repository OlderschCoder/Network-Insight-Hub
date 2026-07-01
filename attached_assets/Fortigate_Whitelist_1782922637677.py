import getpass
import json
import re
import socket
import sys
import time
from typing import Any, Dict, List, Optional, Tuple

import paramiko
import requests


FORTIGATE_HOST = "192.168.1.1"
FORTIGATE_VDOM = "root"
WEBFILTER_PROFILE = "default"
VERIFY_SSL = False
WEBFILTER_ACTION = "exempt"

# Set this to the SSL/SSH inspection profile used by the student policy.
SSL_SSH_PROFILE = "deep-inspection"
SSL_SSH_PROFILE = "custom-deep-inspection"

class FortiGateAPIError(Exception):
    pass


class FortiGateSSHError(Exception):
    pass


def normalize_url_pattern(user_input: str) -> str:
    value = user_input.strip()
    if not value:
        raise ValueError("URL/domain cannot be empty.")

    value = re.sub(r"^https?://", "", value, flags=re.IGNORECASE)
    value = value.strip().strip("/")

    if not value:
        raise ValueError("URL/domain cannot be empty after normalization.")

    if "*" in value:
        return value

    return f"*{value}*"


def extract_hostname(user_input: str) -> str:
    value = user_input.strip()
    if not value:
        raise ValueError("URL/domain cannot be empty.")

    value = re.sub(r"^https?://", "", value, flags=re.IGNORECASE)
    value = value.strip().strip("/")

    if "/" in value:
        value = value.split("/", 1)[0]

    if not value:
        raise ValueError("Could not determine hostname from input.")

    return value.lower()


def normalize_wildcard_fqdn_value(user_input: str) -> str:
    hostname = extract_hostname(user_input)

    if hostname.startswith("*."):
        return hostname

    parts = hostname.split(".")
    if len(parts) >= 3:
        base = ".".join(parts[-2:])
    else:
        base = hostname

    return f"*.{base}"


def wildcard_object_name_from_value(wildcard_value: str) -> str:
    base = wildcard_value.replace("*.", "").replace("*", "")
    base = re.sub(r"[^a-zA-Z0-9]+", "_", base).strip("_").lower()
    return f"wfqdn_{base}"[:35]


def safe_name_from_profile(profile_name: str) -> str:
    clean = re.sub(r"[^A-Za-z0-9_-]+", "_", profile_name.strip())
    return f"{clean}_auto_url_whitelist"


def unwrap_single_result(results: Any, object_name: str) -> Dict[str, Any]:
    if isinstance(results, dict):
        return results

    if isinstance(results, list):
        if len(results) == 0:
            raise FortiGateAPIError(f"{object_name} was not found.")
        if len(results) == 1 and isinstance(results[0], dict):
            return results[0]
        raise FortiGateAPIError(
            f"{object_name} returned an unexpected list with {len(results)} items."
        )

    raise FortiGateAPIError(
        f"{object_name} returned an unexpected response type: {type(results).__name__}"
    )


class FortiGateClient:
    def __init__(self, host: str, token: str, vdom: str = "root", verify_ssl: bool = False) -> None:
        self.host = host.strip()
        self.vdom = vdom.strip()
        self.base_url = f"https://{self.host}/api/v2"
        self.session = requests.Session()
        self.session.verify = verify_ssl
        self.session.headers.update(
            {
                "Authorization": f"Bearer {token.strip()}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            }
        )

        if not verify_ssl:
            try:
                requests.packages.urllib3.disable_warnings()
            except Exception:
                pass

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        payload: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        final_params = {"vdom": self.vdom}
        if params:
            final_params.update(params)

        url = f"{self.base_url}{path}"
        response = self.session.request(
            method=method,
            url=url,
            params=final_params,
            json=payload,
            timeout=30,
        )

        try:
            data = response.json()
        except ValueError:
            raise FortiGateAPIError(
                f"FortiGate returned non-JSON response. HTTP {response.status_code}: {response.text}"
            )

        if response.status_code >= 400:
            raise FortiGateAPIError(
                f"HTTP {response.status_code} calling {path}: {json.dumps(data, indent=2)}"
            )

        return data

    def get_webfilter_profile(self, profile_name: str) -> Dict[str, Any]:
        data = self._request("GET", f"/cmdb/webfilter/profile/{profile_name}")
        results = data.get("results")
        if results is None:
            raise FortiGateAPIError(
                f'Web filter profile "{profile_name}" was not found in VDOM "{self.vdom}".'
            )
        return unwrap_single_result(results, f'Web filter profile "{profile_name}"')

    def update_webfilter_profile_urlfilter_table(self, profile_name: str, table_id: int) -> None:
        payload = {
            "web": {
                "urlfilter-table": table_id
            }
        }
        self._request("PUT", f"/cmdb/webfilter/profile/{profile_name}", payload=payload)

    def list_urlfilter_tables(self) -> List[Dict[str, Any]]:
        data = self._request("GET", "/cmdb/webfilter/urlfilter")
        results = data.get("results", [])
        if isinstance(results, list):
            return results
        if isinstance(results, dict):
            return [results]
        raise FortiGateAPIError("URL filter table list returned an unexpected response type.")

    def get_urlfilter_table(self, table_id: int) -> Dict[str, Any]:
        data = self._request("GET", f"/cmdb/webfilter/urlfilter/{table_id}")
        results = data.get("results")
        if results is None:
            raise FortiGateAPIError(f"URL filter table {table_id} was not found.")
        return unwrap_single_result(results, f"URL filter table {table_id}")

    def create_urlfilter_table(self, table_id: int, name: str) -> None:
        payload = {
            "id": table_id,
            "name": name,
            "entries": []
        }
        self._request("POST", "/cmdb/webfilter/urlfilter", payload=payload)

    def update_urlfilter_table_entries(self, table_id: int, table_name: str, entries: List[Dict[str, Any]]) -> None:
        payload = {
            "id": table_id,
            "name": table_name,
            "entries": entries
        }
        self._request("PUT", f"/cmdb/webfilter/urlfilter/{table_id}", payload=payload)

    def get_next_table_id(self) -> int:
        tables = self.list_urlfilter_tables()
        used_ids: List[int] = []

        for table in tables:
            tid = table.get("id")
            if isinstance(tid, int):
                used_ids.append(tid)
            elif isinstance(tid, str) and tid.isdigit():
                used_ids.append(int(tid))

        return (max(used_ids) + 1) if used_ids else 1


def find_attached_table_id(profile: Dict[str, Any]) -> Optional[int]:
    web_cfg = profile.get("web", {})
    if not isinstance(web_cfg, dict):
        return None

    value = web_cfg.get("urlfilter-table")
    if isinstance(value, int):
        return value

    if isinstance(value, str) and value.isdigit():
        return int(value)

    return None


def entry_exists(entries: List[Dict[str, Any]], url_pattern: str) -> bool:
    for entry in entries:
        existing = str(entry.get("url", "")).strip().lower()
        if existing == url_pattern.lower():
            return True
    return False


def next_entry_id(entries: List[Dict[str, Any]]) -> int:
    ids: List[int] = []

    for entry in entries:
        eid = entry.get("id")
        if isinstance(eid, int):
            ids.append(eid)
        elif isinstance(eid, str) and eid.isdigit():
            ids.append(int(eid))

    return (max(ids) + 1) if ids else 1


def whitelist_url(
    client: FortiGateClient,
    profile_name: str,
    url_pattern: str,
    action: str = "allow"
) -> Tuple[int, str, bool]:
    profile = client.get_webfilter_profile(profile_name)
    table_id = find_attached_table_id(profile)

    if table_id is None:
        table_id = client.get_next_table_id()
        table_name = safe_name_from_profile(profile_name)
        client.create_urlfilter_table(table_id, table_name)
        client.update_webfilter_profile_urlfilter_table(profile_name, table_id)
    else:
        table = client.get_urlfilter_table(table_id)
        table_name = str(table.get("name", f"urlfilter_{table_id}"))

    table = client.get_urlfilter_table(table_id)
    table_name = str(table.get("name", f"urlfilter_{table_id}"))
    entries = table.get("entries", [])

    if not isinstance(entries, list):
        entries = []

    if entry_exists(entries, url_pattern):
        return table_id, table_name, False

    new_entry = {
        "id": next_entry_id(entries),
        "url": url_pattern,
        "type": "wildcard",
        "action": action,
        "status": "enable"
    }

    entries.append(new_entry)
    client.update_urlfilter_table_entries(table_id, table_name, entries)
    return table_id, table_name, True


class FortiGateSSHClient:
    def __init__(self, host: str, username: str, password: str, port: int = 22) -> None:
        self.host = host
        self.username = username
        self.password = password
        self.port = port
        self.client: Optional[paramiko.SSHClient] = None
        self.channel = None

    def __enter__(self) -> "FortiGateSSHClient":
        self.client = paramiko.SSHClient()
        self.client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        self.client.connect(
            hostname=self.host,
            port=self.port,
            username=self.username,
            password=self.password,
            look_for_keys=False,
            allow_agent=False,
            timeout=20,
        )
        self.channel = self.client.invoke_shell()
        time.sleep(1)
        self._read_all()
        self._send("config vdom")
        self._send(f'edit "{FORTIGATE_VDOM}"')
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        try:
            if self.channel is not None:
                self._send("end")
                self.channel.close()
        finally:
            if self.client is not None:
                self.client.close()

    def _read_all(self, timeout: float = 1.0) -> str:
        output = []
        end_time = time.time() + timeout

        while time.time() < end_time:
            if self.channel.recv_ready():
                data = self.channel.recv(65535).decode("utf-8", errors="ignore")
                output.append(data)
                end_time = time.time() + timeout
            else:
                time.sleep(0.1)

        return "".join(output)

    def _send(self, command: str, wait: float = 0.5) -> str:
        if self.channel is None:
            raise FortiGateSSHError("SSH channel is not open.")
        self.channel.send(command + "\n")
        time.sleep(wait)
        return self._read_all()

    def run_commands(self, commands: List[str]) -> str:
        combined_output = []
        for command in commands:
            combined_output.append(self._send(command))
        output = "\n".join(combined_output)

        lowered = output.lower()
        if "command fail" in lowered or "parse error" in lowered or "object check operator error" in lowered:
            raise FortiGateSSHError(output)

        return output

    def list_wildcard_objects(self) -> str:
        commands = [
            "config firewall wildcard-fqdn custom",
            "show",
            "end",
        ]
        return self.run_commands(commands)

    def list_ssl_exemptions(self, profile_name: str) -> str:
        commands = [
            "config firewall ssl-ssh-profile",
            f'edit "{profile_name}"',
            "config ssl-exempt",
            "show",
            "end",
            "end",
        ]
        return self.run_commands(commands)

    def ensure_wildcard_object(self, object_name: str, wildcard_value: str) -> bool:
        show_output = self.list_wildcard_objects()
        if f'edit "{object_name}"' in show_output:
            return False

        commands = [
            "config firewall wildcard-fqdn custom",
            f'edit "{object_name}"',
            f'set wildcard-fqdn "{wildcard_value}"',
            "next",
            "end",
        ]
        self.run_commands(commands)
        return True

    def get_next_ssl_exempt_id(self, profile_name: str) -> int:
        output = self.list_ssl_exemptions(profile_name)
        ids = [int(match) for match in re.findall(r'edit\s+(\d+)', output)]
        return (max(ids) + 1) if ids else 1

    def ssl_exemption_exists(self, profile_name: str, object_name: str) -> bool:
        output = self.list_ssl_exemptions(profile_name)
        return f'set wildcard-fqdn "{object_name}"' in output

    def add_ssl_exemption(self, profile_name: str, object_name: str) -> bool:
        if self.ssl_exemption_exists(profile_name, object_name):
            return False

        next_id = self.get_next_ssl_exempt_id(profile_name)

        commands = [
            "config firewall ssl-ssh-profile",
            f'edit "{profile_name}"',
            "config ssl-exempt",
            f"edit {next_id}",
            "set type wildcard-fqdn",
            f'set wildcard-fqdn "{object_name}"',
            "next",
            "end",
            "end",
        ]
        self.run_commands(commands)
        return True


def prompt_yes_no(message: str, default_no: bool = True) -> bool:
    suffix = " [y/N]: " if default_no else " [Y/n]: "
    value = input(message + suffix).strip().lower()
    if not value:
        return not default_no
    return value in {"y", "yes"}


def main() -> None:
    print("\nFortiGate Student Site Allow Utility\n")

    api_token = getpass.getpass("FortiGate API token: ").strip()
    if not api_token:
        print("API token is required.")
        sys.exit(1)

    raw_url = input("URL to allow: ").strip()
    try:
        url_pattern = normalize_url_pattern(raw_url)
        wildcard_value = normalize_wildcard_fqdn_value(raw_url)
        wildcard_object_name = wildcard_object_name_from_value(wildcard_value)
    except ValueError as exc:
        print(str(exc))
        sys.exit(1)

    add_ssl_bypass = prompt_yes_no("Add SSL inspection bypass for this site?", default_no=True)

    ssh_username = ""
    ssh_password = ""

    if add_ssl_bypass:
        ssh_username = input("FortiGate SSH admin username: ").strip()
        if not ssh_username:
            print("SSH admin username is required when SSL bypass is requested.")
            sys.exit(1)

        ssh_password = getpass.getpass("FortiGate SSH admin password: ").strip()
        if not ssh_password:
            print("SSH admin password is required when SSL bypass is requested.")
            sys.exit(1)

    client = FortiGateClient(
        host=FORTIGATE_HOST,
        token=api_token,
        vdom=FORTIGATE_VDOM,
        verify_ssl=VERIFY_SSL
    )

    try:
        table_id, table_name, web_added = whitelist_url(
            client=client,
            profile_name=WEBFILTER_PROFILE,
            url_pattern=url_pattern,
            action=WEBFILTER_ACTION
        )

        wildcard_object_created = False
        ssl_added = False

        if add_ssl_bypass:
            with FortiGateSSHClient(
                host=FORTIGATE_HOST,
                username=ssh_username,
                password=ssh_password,
            ) as ssh_client:
                wildcard_object_created = ssh_client.ensure_wildcard_object(
                    object_name=wildcard_object_name,
                    wildcard_value=wildcard_value,
                )

                ssl_added = ssh_client.add_ssl_exemption(
                    profile_name=SSL_SSH_PROFILE,
                    object_name=wildcard_object_name,
                )

        print("\nSuccess.")
        print(f"Host: {FORTIGATE_HOST}")
        print(f"VDOM: {FORTIGATE_VDOM}")
        print(f"Web filter profile: {WEBFILTER_PROFILE}")
        print(f"URL filter table ID: {table_id}")
        print(f"URL filter table name: {table_name}")
        print(f"Web filter rule pattern: {url_pattern}")
        print(f"Web filter action: {WEBFILTER_ACTION}")

        if web_added:
            print("Web filter result: The URL was added.")
        else:
            print("Web filter result: The URL already existed.")

        if add_ssl_bypass:
            print(f"SSL/SSH inspection profile: {SSL_SSH_PROFILE}")
            print(f"Wildcard FQDN object name: {wildcard_object_name}")
            print(f"Wildcard FQDN object value: {wildcard_value}")

            if wildcard_object_created:
                print("Wildcard FQDN object result: The object was created.")
            else:
                print("Wildcard FQDN object result: The object already existed.")

            if ssl_added:
                print("SSL inspection result: The bypass entry was added.")
            else:
                print("SSL inspection result: The bypass entry already existed.")

    except FortiGateAPIError as exc:
        print(f"\nFortiGate API error:\n{exc}")
        sys.exit(2)
    except (FortiGateSSHError, paramiko.SSHException, socket.error) as exc:
        print(f"\nFortiGate SSH error:\n{exc}")
        sys.exit(3)
    except requests.RequestException as exc:
        print(f"\nNetwork error:\n{exc}")
        sys.exit(4)


if __name__ == "__main__":
    main()