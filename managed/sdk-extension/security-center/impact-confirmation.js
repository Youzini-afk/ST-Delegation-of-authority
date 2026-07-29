import { Popup, POPUP_RESULT, POPUP_TYPE } from '/scripts/popup.js';
const POPUP_TEXT_TYPE = POPUP_TYPE.TEXT ?? 0;
const POPUP_CONFIRM_RESULT = POPUP_RESULT.CUSTOM1 ?? 1001;
export async function showImpactConfirmation(options) {
    const root = document.createElement('div');
    root.className = `authority-impact-dialog authority-impact-dialog--${options.tone ?? 'warning'}`;
    const heading = document.createElement('div');
    heading.className = 'authority-impact-dialog__heading';
    const title = document.createElement('h3');
    title.textContent = options.title;
    const description = document.createElement('p');
    description.textContent = options.description;
    heading.append(title, description);
    root.appendChild(heading);
    if (options.target) {
        const target = document.createElement('div');
        target.className = 'authority-impact-dialog__target';
        const label = document.createElement('span');
        label.textContent = '目标';
        const value = document.createElement('code');
        value.textContent = options.target;
        target.append(label, value);
        root.appendChild(target);
    }
    if (options.effects?.length) {
        const list = document.createElement('ul');
        list.className = 'authority-impact-dialog__effects';
        for (const effect of options.effects) {
            const item = document.createElement('li');
            item.textContent = effect;
            list.appendChild(item);
        }
        root.appendChild(list);
    }
    const popup = new Popup(root, POPUP_TEXT_TYPE, '', {
        okButton: false,
        cancelButton: '取消',
        customButtons: [{ text: options.confirmLabel, result: POPUP_CONFIRM_RESULT, appendAtEnd: true }],
    });
    return await popup.show() === POPUP_CONFIRM_RESULT;
}
//# sourceMappingURL=impact-confirmation.js.map