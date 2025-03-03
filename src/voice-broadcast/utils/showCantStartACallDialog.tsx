/*
Copyright 2022 The Matrix.org Foundation C.I.C.

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

import InfoDialog from "../../components/views/dialogs/InfoDialog";
import { _t } from "../../languageHandler";
import Modal from "../../Modal";

export const showCantStartACallDialog = () => {
    Modal.createDialog(InfoDialog, {
        title: _t("Can’t start a call"),
        description: (
            <p>
                {_t(
                    "You can’t start a call as you are currently recording a live broadcast. " +
                        "Please end your live broadcast in order to start a call.",
                )}
            </p>
        ),
        hasCloseButton: true,
    });
};
