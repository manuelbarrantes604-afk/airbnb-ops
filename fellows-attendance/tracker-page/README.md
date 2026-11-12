# Speaker Series tracker page (single HTML page)

The free, single-page version of the attendance tracker, hosted as a private
claude.ai page and shared by email invitation.

- `page-template.html`: the page. `__SCHEDULE__` is replaced with the schedule
  text (from the staff Word documents) when the page is built. The schedule and
  all class data are **not** stored in this public repository.
- `check.cjs`: automatic checks run before every update (absences save and show
  for staff, survive reloads, name linking, schedule edits, report totals,
  undo, backup, every screen opens, phone widths).

Data (absences, links between accounts and names, schedule, names, photos, logo)
lives in the page's own database, not in this repository. Staff can download a
full backup from the page footer.
