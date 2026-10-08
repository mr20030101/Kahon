import Swal from 'sweetalert2';
import 'sweetalert2/dist/sweetalert2.min.css';

// SweetAlert2 styled with the app's own buttons and tokens (see .kahon-swal in styles.css).
const KahonSwal = Swal.mixin({
  // Keep html/body at height: 100%; the default height:auto collapses the app layout while open.
  heightAuto: false,
  buttonsStyling: false,
  reverseButtons: true,
  showCancelButton: true,
  cancelButtonText: 'Cancel',
  customClass: {
    popup: 'kahon-swal',
    title: 'kahon-swal-title',
    htmlContainer: 'kahon-swal-text',
    actions: 'kahon-swal-actions',
    confirmButton: 'btn btn-primary',
    cancelButton: 'btn btn-ghost',
  },
});

export const isDialogOpen = () => Swal.isVisible();

// Resolves true when confirmed. Titles and text are plain text (titleText/text),
// never HTML, because they include user-entered names.
export async function confirmDialog({ title, text, confirmText = 'Confirm', danger = false }) {
  const { isConfirmed } = await KahonSwal.fire({
    titleText: title,
    text,
    icon: danger ? 'warning' : 'question',
    confirmButtonText: confirmText,
    focusCancel: danger,
    customClass: {
      popup: 'kahon-swal',
      title: 'kahon-swal-title',
      htmlContainer: 'kahon-swal-text',
      actions: 'kahon-swal-actions',
      confirmButton: danger ? 'btn btn-danger' : 'btn btn-primary',
      cancelButton: 'btn btn-ghost',
    },
  });
  return isConfirmed;
}
