/**
 * Form state extraction — runs inside the browser.
 *
 * Extracts all form fields (including orphan fields not in <form> tags),
 * their types, labels, values, required/disabled state.
 *
 * Based on OpenCLI's getFormStateJs() pattern.
 */
export const FORM_STATE_SCRIPT = `
(() => {
  function extractField(el) {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || tag).toLowerCase();

    // Skip non-user-facing inputs
    if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) return null;

    const name = el.name || el.id || '';

    // Find label via multiple strategies
    const label =
      el.getAttribute('aria-label') ||
      (el.id ? document.querySelector('label[for="' + el.id + '"]')?.textContent?.trim() : null) ||
      el.closest('label')?.textContent?.trim() ||
      el.placeholder ||
      '';

    // Extract value based on type
    let value;
    if (tag === 'select') {
      const selected = el.options[el.selectedIndex];
      value = selected ? selected.textContent.trim() : '';
    } else if (type === 'checkbox' || type === 'radio') {
      value = el.checked;
    } else if (type === 'password') {
      value = el.value ? '••••' : '';
    } else if (el.isContentEditable) {
      value = el.textContent?.trim()?.slice(0, 200) || '';
    } else {
      value = el.value || '';
    }

    return {
      tag,
      type,
      name,
      label: label.slice(0, 80),
      value: typeof value === 'string' ? value.slice(0, 200) : value,
      required: !!el.required,
      disabled: !!el.disabled,
      ref: el.dataset?.ref || null,
    };
  }

  const result = { forms: [], orphanFields: [] };

  // Collect forms
  for (const form of document.forms) {
    const fields = [];
    for (const el of form.elements) {
      const field = extractField(el);
      if (field) fields.push(field);
    }
    result.forms.push({
      id: form.id || '',
      name: form.name || '',
      action: form.action || '',
      method: (form.method || 'get').toUpperCase(),
      fields,
    });
  }

  // Collect orphan fields (not in a <form>)
  const allInputs = document.querySelectorAll(
    'input, textarea, select, [contenteditable="true"]'
  );
  for (const el of allInputs) {
    if (!el.form) {
      const field = extractField(el);
      if (field) result.orphanFields.push(field);
    }
  }

  return result;
})()
`;
