# Ubuntu EC2 troubleshooting

Run these commands in the **Ubuntu SSH terminal** unless marked Windows. Never paste credentials or database contents into support logs.

| Symptom                            | Check / fix                                                                                                                                                                                                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SSH timeout                        | Instance Running/status checks; current IP, public subnet/IGW route, SG port 22 from your current `/32`. If your IP changed, update only that rule.                                                                                                         |
| SSH key permission denied          | Use `ubuntu`, matching key pair, protect the private key; do not regenerate/replace the key blindly.                                                                                                                                                        |
| Public page times out              | SG 80/443, public IPv4, subnet route and `sudo systemctl status nginx`. Node remains loopback only.                                                                                                                                                         |
| 502 Bad Gateway                    | `curl --fail http://127.0.0.1:3000/api/ready`; `sudo journalctl -u cloud-coordination-hub -n 50 --no-pager`; match Nginx upstream to configured port.                                                                                                       |
| Service fails                      | `sudo systemctl status cloud-coordination-hub --no-pager`; check `/etc/cloud-coordination-hub.env`, Node24 executable and build files. After fixing: `sudo systemctl reset-failed cloud-coordination-hub && sudo systemctl restart cloud-coordination-hub`. |
| Login returns 403                  | `APP_ORIGIN` must equal browser protocol/host/port exactly, including the new EC2 IP. No wildcard/CORS workaround. Restart after editing.                                                                                                                   |
| Login succeeds but signs out       | HTTPS requires Secure cookies. For the HTTP demo use SQLite and explicit `ALLOW_INSECURE_HTTP=true`. Do not use real passwords on HTTP. Clear old cookies or use a fresh profile after changing protocol/host.                                              |
| Blank page or asset upgrade        | Verify built `dist/frontend`, Nginx routing and browser console. HTTP demo explicitly removes HSTS/asset upgrade directives; HTTPS retains them. Do not run Vite publicly.                                                                                  |
| Seed says database not empty       | Existing data is protected. Keep existing logins or back up, choose a new `SQLITE_PATH` filename below the state directory, restart, and explicitly seed the new empty database. No automatic erase/reset.                                                  |
| SQLite permissions/read-only       | `sudo ls -ld /var/lib/cloud-coordination-hub`; the directory and DB must be writable by `hub`. Use a path under that directory; systemd intentionally forbids writes elsewhere.                                                                             |
| Build killed / exit 137            | Check `free -h` and `df -h`; provision a permitted larger instance or use the documented temporary swap procedure. Never solve this by deleting the database.                                                                                               |
| Old version after update           | Check `readlink -f /opt/cloud-coordination-hub/current`; the deploy script retains old releases and rolls code back when activation fails. Inspect journal; do not repeatedly rerun without finding the cause.                                              |
| CloudFormation/AMI/type denied     | The Sandbox policy was not inspected. Use manual EC2 creation with permitted type/region/official Ubuntu AMI, or ask the instructor if EC2 itself is denied. No IAM/PassRole is needed for SQLite.                                                          |
| Instance disappeared after End Lab | Check that specific lab's reset policy. If deleted, redeploy source to a new instance and restore a private SQLite backup or create a fresh demo.                                                                                                           |

Useful commands:

```bash
sudo nginx -t
sudo journalctl -u cloud-coordination-hub --since '10 minutes ago' --no-pager
sudo ss -ltnp
df -h
curl --fail http://127.0.0.1:3000/api/health
curl --fail http://127.0.0.1:3000/api/ready
```

For code rollback, identify a previous successful release under `/opt/cloud-coordination-hub/releases`, stop the service, point `current` to that **verified existing** release with `sudo ln -sfn /opt/cloud-coordination-hub/releases/REPLACE_WITH_RELEASE /opt/cloud-coordination-hub/current`, then restart and test readiness. Keep the configured database unchanged. This release introduces no schema migration; a future incompatible migration must be handled separately. Backups are not automatically restored because that would overwrite current data.
