# AWS presentation checklist

Follow [the full deployment guide](AWS_EC2_DEPLOYMENT.md) for exact setup commands. No application is claimed deployed yet.

Before presentation:

- Start your Academy lab; check budget and current resources, region, public IP and status checks.
- Confirm the prepared changes were uploaded or personally pushed/cloned; unchanged GitHub main will not contain them.
- Use one Ubuntu EC2, EBS SQLite, Nginx, Express and built React. No managed database, ALB, ASG or NAT needed.
- SSH from your `/32`; expose 80 (and 443 for TLS), never 3000/5173.
- Update `/etc/cloud-coordination-hub.env` and Nginx if the IP changed; restart the app and reload Nginx.
- `sudo systemctl is-active cloud-coordination-hub nginx` and `curl --fail http://127.0.0.1:3000/api/ready`.
- Open the public URL; check browser console/network errors and reload an SPA route.
- Explicitly seed only a fresh database. Record generated demo credentials privately; never show the seed terminal during a recording.

Demonstrate:

1. Organizer logs in, sees existing sample events/poll/slot and creates a small-capacity event.
2. Attendee logs in in a separate browser profile, registers and votes. Another attendee can sign up to demonstrate waitlist promotion.
3. Organizer retrieves registrations/CSV, showing ownership restrictions and actual database-backed records.
4. Restart the service with `sudo systemctl restart cloud-coordination-hub`; reload and show records are still present.
5. Show health/readiness and the actual single-instance architecture. Explain that HTTP uses disposable demo identities and is a temporary transport-security compromise.

After presentation: make/download a consistent SQLite backup, stop the instance in EC2, inspect retained storage/addresses and remaining budget, then follow the lab's own End Lab policy. Termination/reset can delete your data. Retest after any restart or public IP change; do not rely only on preparation test results.
