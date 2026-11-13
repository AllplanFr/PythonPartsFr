"""Native Windows integration not exposed by pywebview's file-dialog API."""

import os
from importlib import import_module
from urllib.parse import urlsplit


def create_file_dialog(window, dialog_type, *, title, **options):
    native = vars(window).get("native")
    if os.name != "nt" or native is None:
        return window.create_file_dialog(dialog_type, **options)

    system = import_module("System")
    forms = import_module("System.Windows.Forms")
    from webview import FileDialog
    from webview.util import parse_file_type

    result = None
    error = None

    def show():
        nonlocal result, error
        dialog = (
            forms.FolderBrowserDialog() if dialog_type == FileDialog.FOLDER
            else forms.SaveFileDialog() if dialog_type == FileDialog.SAVE else forms.OpenFileDialog()
        )
        try:
            directory = options.get("directory", "")
            if dialog_type == FileDialog.FOLDER:
                dialog.Description = title
                dialog.SelectedPath = directory
                dialog.ShowNewFolderButton = False
                if hasattr(dialog, "UseDescriptionForTitle"):
                    dialog.UseDescriptionForTitle = True
            else:
                dialog.Title = title
                dialog.InitialDirectory = directory
                dialog.RestoreDirectory = True
                filters = options.get("file_types", ())
                dialog.Filter = "|".join(
                    "{0} ({1})|{1}".format(*parse_file_type(value)) for value in filters
                ) if filters else window.localization["windows.fileFilter.allFiles"] + " (*.*)|*.*"
                if dialog_type == FileDialog.SAVE:
                    dialog.FileName = options.get("save_filename", "")
                else:
                    dialog.Multiselect = options.get("allow_multiple", False)
            if dialog.ShowDialog(native) == forms.DialogResult.OK:
                if dialog_type == FileDialog.FOLDER:
                    result = str(dialog.SelectedPath)
                else:
                    result = tuple(str(path) for path in dialog.FileNames)
        except Exception as exc:
            # Propagate UI-thread errors to the bridge instead of treating them as cancellation.
            error = exc
        finally:
            dialog.Dispose()

    native.Invoke(system.Action(show))
    if error is not None:
        raise error
    return result


def clipboard_request_allowed(uri, trusted_url, permission_kind):
    requested = urlsplit(uri)
    trusted = urlsplit(trusted_url)
    return (
        permission_kind == "ClipboardRead"
        and requested.scheme == trusted.scheme == "https"
        and requested.hostname == trusted.hostname
        and (requested.port or 443) == (trusted.port or 443)
    )


def confirm_discard_work(window, *, values, presentation, pending):
    """A cancel-first native confirmation; never offers a save operation."""
    native = vars(window).get("native")
    if os.name != "nt" or native is None:
        raise RuntimeError("Dialogue natif de protection du brouillon indisponible.")
    system = import_module("System")
    forms = import_module("System.Windows.Forms")
    drawing = import_module("System.Drawing")
    accepted = False
    error = None

    def show():
        nonlocal accepted, error
        dialog = forms.Form()
        try:
            dialog.Text = "Modifications non enregistrees"
            dialog.ClientSize = drawing.Size(540, 180)
            dialog.FormBorderStyle = forms.FormBorderStyle.FixedDialog
            dialog.StartPosition = forms.FormStartPosition.CenterParent
            dialog.MinimizeBox = dialog.MaximizeBox = False
            losses = []
            if values:
                losses.append("les valeurs modifiees en memoire")
            if presentation:
                losses.append("les modifications de presentation")
            if pending:
                losses.append("l'import de presentation en attente")
            label = forms.Label()
            label.Text = "Fermer abandonnera " + ", ".join(losses) + ".\nAucun fichier ne sera enregistre."
            label.Location = drawing.Point(16, 16)
            label.Size = drawing.Size(508, 90)
            cancel = forms.Button()
            cancel.Text = "Annuler"
            cancel.Location = drawing.Point(172, 128)
            cancel.Size = drawing.Size(110, 32)
            cancel.DialogResult = forms.DialogResult.Cancel
            discard = forms.Button()
            discard.Text = "Abandonner les modifications"
            discard.Location = drawing.Point(294, 128)
            discard.Size = drawing.Size(230, 32)
            discard.DialogResult = forms.DialogResult.OK
            for control in (label, cancel, discard):
                dialog.Controls.Add(control)
            dialog.CancelButton = dialog.AcceptButton = cancel
            accepted = dialog.ShowDialog(native) == forms.DialogResult.OK
        except Exception as exc:
            error = exc
        finally:
            dialog.Dispose()

    native.Invoke(system.Action(show))
    if error is not None:
        raise error
    return accepted


def configure_clipboard(window, trusted_url, logger):
    if os.name != "nt":
        logger.info("Clipboard permissions use the platform browser policy.")
        return
    native = getattr(window, "native", None)
    control = getattr(native, "webview", None)
    if control is None or not hasattr(type(control), "CoreWebView2"):
        logger.warning("Clipboard API unavailable on this renderer; use Ctrl+V.")
        return
    if getattr(window, "_clipboard_permission_handler", None) is not None:
        return
    system = import_module("System")
    core = import_module("Microsoft.Web.WebView2.Core")

    def on_permission(_sender, args):
        if clipboard_request_allowed(str(args.Uri), trusted_url, str(args.PermissionKind)):
            args.State = core.CoreWebView2PermissionState.Allow

    def attach():
        control.CoreWebView2.PermissionRequested += on_permission

    native.Invoke(system.Action(attach))
    window._clipboard_permission_handler = on_permission
