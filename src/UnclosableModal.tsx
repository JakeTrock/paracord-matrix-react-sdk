/*
Copyright 2015, 2016 OpenMarket Ltd
Copyright 2020 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import React from "react";
import ReactDOM from "react-dom";
import classNames from "classnames";
import { defer, sleep } from "matrix-js-sdk/src/utils";
import { TypedEventEmitter } from "matrix-js-sdk/src/models/typed-event-emitter";

import dis from "./dispatcher/dispatcher";
import AsyncWrapper from "./AsyncWrapper";

const DIALOG_CONTAINER_ID = "mx_Dialog_Container";
const STATIC_DIALOG_CONTAINER_ID = "mx_Dialog_StaticContainer";

export interface IModal<T extends any[]> {
    elem: React.ReactNode;
    className?: string;
    beforeClosePromise?: Promise<boolean>;
    closeReason?: string;
    onBeforeClose?(reason?: string): Promise<boolean>;
    onFinished(...args: T): void;
    close(...args: T): void;
    hidden?: boolean;
}

export interface IHandle<T extends any[]> {
    finished: Promise<T>;
    close(...args: T): void;
}

interface IProps<T extends any[]> {
    onFinished?(...args: T): void;
    // TODO improve typing here once all Modals are TS and we can exhaustively check the props
    [key: string]: any;
}

interface IOptions<T extends any[]> {
    onBeforeClose?: IModal<T>["onBeforeClose"];
}

type ParametersWithoutFirst<T extends (...args: any) => any> = T extends (a: any, ...args: infer P) => any ? P : never;

export enum ModalManagerEvent {
    Opened = "opened",
}

type HandlerMap = {
    [ModalManagerEvent.Opened]: () => void;
};

export class UnclosableModalManager extends TypedEventEmitter<ModalManagerEvent, HandlerMap> {
    private counter = 0;
    // The modal to prioritise over all others. If this is set, only show
    // this modal. Remove all other modals from the stack when this modal
    // is closed.
    private priorityModal: IModal<any> = null;
    // The modal to keep open underneath other modals if possible. Useful
    // for cases like Settings where the modal should remain open while the
    // user is prompted for more information/errors.
    private staticModal: IModal<any> = null;
    // A list of the modals we have stacked up, with the most recent at [0]
    // Neither the static nor priority modal will be in this list.
    private modals: IModal<any>[] = [];

    private static getOrCreateContainer() {
        let container = document.getElementById(DIALOG_CONTAINER_ID);

        if (!container) {
            container = document.createElement("div");
            container.id = DIALOG_CONTAINER_ID;
            document.body.appendChild(container);
        }

        return container;
    }

    private static getOrCreateStaticContainer() {
        let container = document.getElementById(STATIC_DIALOG_CONTAINER_ID);

        if (!container) {
            container = document.createElement("div");
            container.id = STATIC_DIALOG_CONTAINER_ID;
            document.body.appendChild(container);
        }

        return container;
    }

    public toggleCurrentDialogVisibility() {
        const modal = this.getCurrentModal();
        if (!modal) return;
        modal.hidden = !modal.hidden;
    }

    public hasDialogs() {
        return this.priorityModal || this.staticModal || this.modals.length > 0;
    }

    public createDialog<T extends any[]>(
        Element: React.ComponentType<any>,
        ...rest: ParametersWithoutFirst<UnclosableModalManager["createDialogAsync"]>
    ) {
        return this.createDialogAsync<T>(Promise.resolve(Element), ...rest);
    }

    public appendDialog<T extends any[]>(
        Element: React.ComponentType,
        ...rest: ParametersWithoutFirst<UnclosableModalManager["appendDialogAsync"]>
    ) {
        return this.appendDialogAsync<T>(Promise.resolve(Element), ...rest);
    }

    private buildModal<T extends any[]>(
        prom: Promise<React.ComponentType>,
        props?: IProps<T>,
        className?: string,
        options?: IOptions<T>,
    ) {
        const modal: IModal<T> = {
            onFinished: props ? props.onFinished : null,
            onBeforeClose: options.onBeforeClose,
            beforeClosePromise: null,
            closeReason: null,
            className,

            // these will be set below but we need an object reference to pass to getCloseFn before we can do that
            elem: null,
            close: null,
        };

        // never call this from onFinished() otherwise it will loop
        const [closeDialog, onFinishedProm] = this.getCloseFn<T>(modal, props);

        // don't attempt to reuse the same AsyncWrapper for different dialogs,
        // otherwise we'll get confused.
        const modalCount = this.counter++;

        // FIXME: If a dialog uses getDefaultProps it clobbers the onFinished
        // property set here so you can't close the dialog from a button click!
        modal.elem = <AsyncWrapper key={modalCount} prom={prom} {...props} onFinished={closeDialog} />;
        modal.close = closeDialog;

        return { modal, closeDialog, onFinishedProm };
    }

    private getCloseFn<T extends any[]>(
        modal: IModal<T>,
        props: IProps<T>,
    ): [IHandle<T>["close"], IHandle<T>["finished"]] {
        const deferred = defer<T>();
        return [
            async (...args: T) => {
                if (modal.beforeClosePromise) {
                    await modal.beforeClosePromise;
                } else if (modal.onBeforeClose) {
                    modal.beforeClosePromise = modal.onBeforeClose(modal.closeReason);
                    const shouldClose = await modal.beforeClosePromise;
                    modal.beforeClosePromise = null;
                    if (!shouldClose) {
                        return;
                    }
                }
                deferred.resolve(args);
                if (props && props.onFinished) props.onFinished.apply(null, args);
                const i = this.modals.indexOf(modal);
                if (i >= 0) {
                    this.modals.splice(i, 1);
                }

                if (this.priorityModal === modal) {
                    this.priorityModal = null;

                    // XXX: This is destructive
                    this.modals = [];
                }

                if (this.staticModal === modal) {
                    this.staticModal = null;

                    // XXX: This is destructive
                    this.modals = [];
                }

                this.reRender();
            },
            deferred.promise,
        ];
    }

    /**
     * @callback onBeforeClose
     * @param {string?} reason either "backgroundClick" or null
     * @return {Promise<bool>} whether the dialog should close
     */

    /**
     * Open a modal view.
     *
     * This can be used to display a react component which is loaded as an asynchronous
     * webpack component. To do this, set 'loader' as:
     *
     *   (cb) => {
     *       require(['<module>'], cb);
     *   }
     *
     * @param {Promise} prom   a promise which resolves with a React component
     *   which will be displayed as the modal view.
     *
     * @param {Object} props   properties to pass to the displayed
     *    component. (We will also pass an 'onFinished' property.)
     *
     * @param {String} className   CSS class to apply to the modal wrapper
     *
     * @param {boolean} isPriorityModal if true, this modal will be displayed regardless
     *                                  of other modals that are currently in the stack.
     *                                  Also, when closed, all modals will be removed
     *                                  from the stack.
     * @param {boolean} isStaticModal  if true, this modal will be displayed under other
     *                                 modals in the stack. When closed, all modals will
     *                                 also be removed from the stack. This is not compatible
     *                                 with being a priority modal. Only one modal can be
     *                                 static at a time.
     * @param {Object} options? extra options for the dialog
     * @param {onBeforeClose} options.onBeforeClose a callback to decide whether to close the dialog
     * @returns {object} Object with 'close' parameter being a function that will close the dialog
     */
    public createDialogAsync<T extends any[]>(
        prom: Promise<React.ComponentType>,
        props?: IProps<T>,
        className?: string,
        isPriorityModal = false,
        isStaticModal = false,
        options: IOptions<T> = {},
    ): IHandle<T> {
        const beforeModal = this.getCurrentModal();
        const { modal, closeDialog, onFinishedProm } = this.buildModal<T>(prom, props, className, options);
        if (isPriorityModal) {
            // XXX: This is destructive
            this.priorityModal = modal;
        } else if (isStaticModal) {
            // This is intentionally destructive
            this.staticModal = modal;
        } else {
            this.modals.unshift(modal);
        }

        this.reRender();
        this.emitIfChanged(beforeModal);

        return {
            close: closeDialog,
            finished: onFinishedProm,
        };
    }

    private appendDialogAsync<T extends any[]>(
        prom: Promise<React.ComponentType>,
        props?: IProps<T>,
        className?: string,
    ): IHandle<T> {
        const beforeModal = this.getCurrentModal();
        const { modal, closeDialog, onFinishedProm } = this.buildModal<T>(prom, props, className, {});

        this.modals.push(modal);

        this.reRender();
        this.emitIfChanged(beforeModal);

        return {
            close: closeDialog,
            finished: onFinishedProm,
        };
    }

    private emitIfChanged(beforeModal?: IModal<any>): void {
        if (beforeModal !== this.getCurrentModal()) {
            this.emit(ModalManagerEvent.Opened);
        }
    }

    private getCurrentModal(): IModal<any> {
        return this.priorityModal ? this.priorityModal : this.modals[0] || this.staticModal;
    }

    private async reRender() {
        // await next tick because sometimes ReactDOM can race with itself and cause the modal to wrongly stick around
        await sleep(0);

        if (this.modals.length === 0 && !this.priorityModal && !this.staticModal) {
            // If there is no modal to render, make all of Element available
            // to screen reader users again
            dis.dispatch({
                action: "aria_unhide_main_app",
            });
            ReactDOM.unmountComponentAtNode(UnclosableModalManager.getOrCreateContainer());
            ReactDOM.unmountComponentAtNode(UnclosableModalManager.getOrCreateStaticContainer());
            return;
        }

        // Hide the content outside the modal to screen reader users
        // so they won't be able to navigate into it and act on it using
        // screen reader specific features
        dis.dispatch({
            action: "aria_hide_main_app",
        });

        if (this.staticModal) {
            const classes = classNames("mx_Dialog_wrapper mx_Dialog_staticWrapper", this.staticModal.className);

            const staticDialog = (
                <div className={classes}>
                    <div className="mx_Dialog">{this.staticModal.elem}</div>
                    {/* <div
                        data-testid="dialog-background"
                        className="mx_Dialog_background mx_Dialog_staticBackground"
                    /> */}
                </div>
            );

            ReactDOM.render(staticDialog, UnclosableModalManager.getOrCreateStaticContainer());
        } else {
            // This is safe to call repeatedly if we happen to do that
            ReactDOM.unmountComponentAtNode(UnclosableModalManager.getOrCreateStaticContainer());
        }

        const modal = this.getCurrentModal();
        if (modal !== this.staticModal && !modal.hidden) {
            const classes = classNames("mx_Dialog_wrapper", modal.className, {
                mx_Dialog_wrapperWithStaticUnder: this.staticModal,
            });

            const dialog = (
                <div className={classes}>
                    <div className="mx_Dialog">{modal.elem}</div>
                    {/* <div
                        data-testid="dialog-background"
                        className="mx_Dialog_background"
                    /> */}
                </div>
            );

            setImmediate(() => ReactDOM.render(dialog, UnclosableModalManager.getOrCreateContainer()));
        } else {
            // This is safe to call repeatedly if we happen to do that
            ReactDOM.unmountComponentAtNode(UnclosableModalManager.getOrCreateContainer());
        }
    }
}

if (!window.singletonModalManager) {
    window.singletonModalManager = new UnclosableModalManager();
}
export default window.singletonModalManager;
