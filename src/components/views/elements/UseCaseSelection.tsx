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

import React, { useEffect } from "react";
import { _t } from "matrix-react-sdk/src/languageHandler";
import { UseCase } from "matrix-react-sdk/src/settings/enums/UseCase";
import SplashPage from "matrix-react-sdk/src/components/structures/SplashPage";

interface Props {
    onFinished: (useCase: UseCase) => void;
}

const TIMEOUT = 2500;

export function UseCaseSelection({ onFinished }: Props) {

    // Call onFinished 1.5s after `selection` becomes truthy, to give time for the animation to run
    useEffect(() => {
        window.setTimeout(() => {
            onFinished(UseCase.CommunityMessaging);
        }, TIMEOUT);
    });

    return (
        <SplashPage
            className="mx_UseCaseSelection"
        >
            <div className="mx_UseCaseSelection_title mx_UseCaseSelection_slideIn">
                <h1>{_t("You're in")}</h1>
                <img src="themes/paracordBrand/web/paracord.svg" alt="Paracord" />
            </div>
        </SplashPage>
    );
}
