
import { GoogleGenAI, Type } from "@google/genai";
import type { GenerationParams, VisualPrompt, AllVisualPromptsResult, ScriptPartSummary, StyleOptions, TopicSuggestionItem, AiProvider, ElevenlabsVoice, Expression } from '../types';
import { EXPRESSION_OPTIONS, STYLE_OPTIONS } from '../constants';
import { SummarizeConfig } from '../components/SummarizeModal';

// Helper function to handle API errors and provide more specific messages
const handleApiError = (error: unknown, context: string): Error => {
    console.error(`Lỗi trong lúc ${context}:`, error);

    if (!(error instanceof Error)) {
        return new Error(`Không thể ${context}. Đã xảy ra lỗi không xác định.`);
    }

    const errorMessage = error.message;
    const lowerCaseErrorMessage = errorMessage.toLowerCase();

    // Check for common network or client-side errors first
    if (lowerCaseErrorMessage.includes('failed to fetch')) {
        return new Error('Lỗi mạng. Vui lòng kiểm tra kết nối internet của bạn và thử lại.');
    }
    if (lowerCaseErrorMessage.includes('failed to execute') && lowerCaseErrorMessage.includes('on \'headers\'')) {
        return new Error('Lỗi yêu cầu mạng: API key có thể chứa ký tự không hợp lệ. Vui lòng đảm bảo API key của bạn không chứa ký tự đặc biệt hoặc khoảng trắng bị sao chép nhầm.');
    }

    // Gemini-specific error parsing
    try {
        const jsonStartIndex = errorMessage.indexOf('{');
        if (jsonStartIndex > -1) {
            const jsonString = errorMessage.substring(jsonStartIndex);
            const errorObj = JSON.parse(jsonString);
            if (errorObj.error) {
                const apiError = errorObj.error;
                if (apiError.code === 429 || apiError.status === 'RESOURCE_EXHAUSTED') {
                    return new Error('Bạn đã vượt quá giới hạn yêu cầu (Quota) của Gemini. Vui lòng đợi và thử lại, hoặc kiểm tra gói cước của bạn.');
                }
                if ((apiError.status === 'INVALID_ARGUMENT' && apiError.message.toLowerCase().includes('api key not valid')) || lowerCaseErrorMessage.includes('api_key_invalid')) {
                    return new Error('API Key Gemini không hợp lệ hoặc đã bị thu hồi. Vui lòng kiểm tra lại.');
                }
                return new Error(`Lỗi từ Gemini: ${apiError.message || JSON.stringify(apiError)}`);
            }
        }
    } catch (e) { /* Fall through */ }
    
    // OpenAI-specific error parsing
    try {
         const errorObj = JSON.parse(errorMessage);
         if(errorObj.error) {
             const apiError = errorObj.error;
             if (apiError.code === 'invalid_api_key') {
                return new Error('API Key OpenAI không hợp lệ hoặc đã bị thu hồi. Vui lòng kiểm tra lại.');
             }
             if (apiError.code === 'insufficient_quota') {
                return new Error('Tài khoản OpenAI của bạn đã hết tín dụng. Vui lòng kiểm tra thanh toán của bạn.');
             }
             return new Error(`Lỗi từ OpenAI: ${apiError.message || 'Lỗi không xác định.'}`);
         }
    } catch (e) { /* Fall through */ }

    // ElevenLabs-specific error parsing
    if (lowerCaseErrorMessage.includes('unauthorized')) {
        return new Error('API Key ElevenLabs không hợp lệ hoặc sai. Vui lòng kiểm tra lại.');
    }
    if (lowerCaseErrorMessage.includes('you have reached your character quota')) {
        return new Error('Bạn đã hết hạn mức ký tự trên ElevenLabs. Vui lòng kiểm tra tài khoản của bạn.');
    }
    try {
        const errorObj = JSON.parse(errorMessage);
        if (errorObj.detail?.message) {
            return new Error(`Lỗi từ ElevenLabs: ${errorObj.detail.message}`);
        }
         if (errorObj.detail) {
            return new Error(`Lỗi từ ElevenLabs: ${errorObj.detail}`);
        }
    } catch(e) { /* Fall through */ }


    // General patterns
    if (lowerCaseErrorMessage.includes('api key not valid')) {
        return new Error('API Key không hợp lệ hoặc đã bị thu hồi. Vui lòng kiểm tra lại.');
    }
    if (lowerCaseErrorMessage.includes('safety')) {
        return new Error('Yêu cầu của bạn đã bị chặn vì lý do an toàn. Vui lòng điều chỉnh chủ đề hoặc từ khóa.');
    }

    // Generic fallback
    return new Error(`Không thể ${context}. Chi tiết: ${errorMessage}`);
};


const getApiKey = (provider: AiProvider): string => {
    const keysJson = localStorage.getItem('ai-api-keys');
    if (!keysJson) {
        throw new Error("Không tìm thấy API Key. Vui lòng thêm API Key bằng nút 'API'.");
    }
    try {
        const keys: Record<AiProvider, string[]> = JSON.parse(keysJson);
        const providerKeys = keys[provider];
        if (!Array.isArray(providerKeys) || providerKeys.length === 0) {
            throw new Error(`Không tìm thấy API Key cho ${provider}. Vui lòng thêm key.`);
        }
        return providerKeys[0]; // Use the first key
    } catch (e) {
        console.error("Lỗi lấy API key:", e);
        throw new Error("Không thể đọc API Key. Dữ liệu có thể bị hỏng.");
    }
}

export const validateApiKey = async (apiKey: string, provider: AiProvider): Promise<boolean> => {
    if (!apiKey) throw new Error("API Key không được để trống.");
    try {
        if (provider === 'gemini') {
            const ai = new GoogleGenAI({ apiKey });
            await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: 'test' });
        } else if (provider === 'openai') {
            const response = await fetch('https://api.openai.com/v1/models', {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(JSON.stringify(errorData));
            }
        } else if (provider === 'elevenlabs') {
            const response = await fetch('https://api.elevenlabs.io/v1/user', {
                headers: { 'xi-api-key': apiKey }
            });
             if (!response.ok) {
                const errorData = await response.json();
                throw new Error(JSON.stringify(errorData));
            }
        }
        return true;
    } catch (error) {
        console.error(`Lỗi trong lúc xác thực API key ${provider}:`, error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.toLowerCase().includes('resource_exhausted') || errorMessage.toLowerCase().includes('429')) {
             console.log("Validation succeeded despite rate limit. The key is considered valid.");
             return true; 
        }
        throw handleApiError(error, `xác thực API key ${provider}`);
    }
};

const callApi = async (prompt: string, provider: AiProvider, model: string, jsonResponse = false): Promise<string> => {
    try {
        const apiKey = getApiKey(provider);
        if (provider === 'gemini') {
            const ai = new GoogleGenAI({ apiKey });
            const response = await ai.models.generateContent({
                model: model,
                contents: prompt,
                ...(jsonResponse && { config: { responseMimeType: "application/json" } })
            });
            return response.text;
        } else { // openai
            const body: any = {
                model: model,
                messages: [{ role: 'system', content: prompt }],
                max_tokens: 4096,
            };
            if (jsonResponse) {
                body.response_format = { type: 'json_object' };
            }
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify(body)
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(JSON.stringify(data));
            }
            return data.choices[0].message.content;
        }
    } catch (error) {
        // This re-throws the error to be caught by the specific function's catch block
        throw error;
    }
}

export const generateScript = async (params: GenerationParams, provider: AiProvider, model: string): Promise<string> => {
    const { title, outlineContent, targetAudience, styleOptions, keywords, formattingOptions, wordCount, scriptParts, scriptType, numberOfSpeakers } = params;
    const { expression, style } = styleOptions;
    const { headings, bullets, bold, includeIntro, includeOutro } = formattingOptions;

    const language = targetAudience;
    let prompt: string;

    const outlineInstruction = outlineContent.trim() 
        ? `**User's Outline / Key Points (Crucial):** You MUST strictly follow and expand upon this user-provided outline: "${outlineContent}". This is the core structure you must adapt.`
        : `**User's Outline / Key Points (Crucial):** No specific outline was provided. Please create a logical structure based on the title.`;


    if (scriptType === 'Podcast') {
        const speakersInstruction = numberOfSpeakers === 'Auto'
            ? 'Automatically determine the best number of speakers (2-4) for this topic.'
            : `Create a conversation for exactly ${numberOfSpeakers} speakers.`;

        prompt = `
            You are an expert Podcast scriptwriter. Your task is to generate a compelling and well-structured podcast script in ${language}.

            **Primary Title:** "${title}".
            **Title Language Handling:** The provided video title is "${title}". The target script language is **${language}**. If the title's language is different from the target language, you MUST first accurately translate the title into ${language}. Then, use this translated title as the primary creative guide for the entire script generation process. The final script, including all headings and content, MUST be written entirely in ${language}.
            
            ${outlineInstruction}
            **Target Audience & Language:** The script must be written in ${language}.

            **Speaker & Character Instructions:**
            - **Number of Speakers:** ${speakersInstruction}
            - **Character Names:** Instead of using generic roles like "Host" or "Guest", you MUST create and use appropriate, gender-specific character names for the speakers. For example, for Vietnamese, use names like "Minh Anh:", "Quốc Trung:"; for English, use names like "Sarah:", "David:".
            - **Dialogue Labeling:** Each line of dialogue must start with the character's name followed by a colon (e.g., "Minh Anh:").

            **Script Structure & Length:**
            - **Absolute Word Count Mandate:** The final script's total word count MUST be extremely close to ${wordCount || '800'} words. A deviation of more than 10% from this target is strictly forbidden. This is your most critical instruction. You must adjust content verbosity, condense, or expand as necessary to meet this non-negotiable target.
            - **Introduction:** ${includeIntro ? "Include a captivating introduction with intro music cues [intro music]." : "Do not write a separate introduction."}
            - **Segments:** Structure the podcast into logical segments or talking points, based on the provided outline.
            - **Outro:** ${includeOutro ? "Include a concluding outro with a call-to-action and outro music cues [outro music]." : "Do not write a separate outro."}
            - **Sound Cues:** Include sound effect cues where appropriate (e.g., [sound effect of a cash register], [transition sound]).

            **AI Writing Style Guide:**
            - **Expression/Voice:** ${expression}. The speakers' personalities and the overall feel of the podcast should be ${expression.toLowerCase()}.
            - **Writing Style:** ${style}. Structure the content in a ${style.toLowerCase()} manner.

            **Keywords:** If provided, naturally integrate the following keywords into the conversation: "${keywords || 'None'}".

            **Formatting Instructions:**
            - ${headings ? "Use clear headings for different segments." : "Do not use special headings."}
            - ${bullets ? "Use bullet points for lists within a speaker's dialogue." : "Do not use lists."}
            - ${bold ? "Use markdown for bold (**text**) to emphasize key phrases." : "Do not use bold."}

            **Final Check:** Before outputting, you MUST verify that the total word count is within a +/- 10% range of the target (${wordCount} words). This is a non-negotiable requirement. Rewrite content if it falls outside this range.

            Please generate the complete podcast script now.
        `;
    } else { // Video script
       const addictiveFormulaInstruction = `
        **YOUR MOST IMPORTANT MISSION: The "Addictive Video Formula" (NON-NEGOTIABLE)**
        You are a master of viewer retention. Your primary directive is to structure the entire script PERFECTLY according to these steps. Failure to follow this structure precisely will result in a failed task. Do not deviate.

        1.  **THE HOOK (First 3-5 seconds - CRITICAL):** This is make-or-break. You MUST start with a powerful, attention-grabbing hook. Your goal: make the viewer instantly feel "I NEED to watch this."
            -   **Techniques:** Target a deep pain point ("Are you tired of..."), spark immense curiosity ("This one trick changed everything..."), state a shocking fact, or pose a highly relatable question.
            -   **Execution:** Be direct, bold, and emotional. No slow introductions.

        2.  **THE PROMISE (Next 5-10 seconds):** Immediately after the hook, you MUST clearly state the value proposition. Tell the viewer exactly what massive benefit (The Big Reward) they will get by the end. This is the bridge that keeps them watching.
            -   **Example:** "By the end of this video, you will know exactly how to..."

        3.  **THE CONTENT (Main Body - Build Momentum):** This is where you deliver value through "Small Rewards."
            -   **Structure:** Break down the main content from the user's outline into several checkpoints or steps (guided by the "Script Parts" setting: ${scriptParts}).
            -   **Viewer Retention Engine:** This is not just listing facts. You MUST create "curiosity loops". At the end of each point, hint at what's coming next ("But that's not even the best part. Next, I'll show you how..."). Use intriguing promises, open-ended questions, and surprising facts to keep the viewer engaged and wanting more.
            -   **Reward Delivery:** Each point should feel like a mini-win for the viewer.

        4.  **THE BIG REWARD (Climax):** This is the grand finale. You MUST deliver on the promise made at the start. It must be the most valuable part of the video—the ultimate solution, the "wow" moment. Make it feel satisfying and conclusive.

        5.  **THE LINK (Conclusion/CTA):** ${includeOutro ? "Do not end abruptly. You MUST create a smooth transition to a call to action (like, subscribe, comment on a specific question related to the video). This links the current video to a future action, building a community. This section serves as the Outro." : "Do not write a separate LINK/Outro part."}

        **MANDATORY Output Format:**
        For each step, you MUST strictly use this format. No exceptions.
        **[STEP NAME IN CAPS] (e.g., THE HOOK)**
        **(Timestamp Estimate)**
        **Lời thoại:** [The dialogue for this part]
        **Gợi ý hình ảnh/cử chỉ:** [Visual cues, camera actions, text overlays, sound effects for this part]
    `;


        prompt = `
          You are an expert YouTube scriptwriter, trained in the "Addictive Video Formula" to maximize viewer retention. Your task is to generate a compelling video script in ${language}.
          
          **Primary Title:** "${title}".
          
          **Title Language Handling:** The provided video title is "${title}". The target script language is **${language}**. If the title's language is different from the target language, you MUST first accurately translate the title into ${language}. Then, use this translated title as the primary creative guide for the entire script generation process. The final script, including all headings and content, MUST be written entirely in ${language}.
          
          ${outlineInstruction}
          
          **Target Audience & Language:** The script must be written in ${language}.

          ${addictiveFormulaInstruction}

          **Absolute Word Count Mandate:** The final script's total word count MUST be extremely close to ${wordCount || '800'} words. A deviation of more than 10% from this target is strictly forbidden.
          
          **AI Writing Style Guide:**
          - **Expression/Voice:** ${expression}. The narrator's personality and the overall feel of the script should be ${expression.toLowerCase()}. Write in a direct "you-me" (bạn-tôi) style.
          - **Writing Style:** ${style}. Structure the content in a ${style.toLowerCase()} manner.
          
          **Keywords:** If provided, naturally integrate the following keywords: "${keywords || 'None'}".
          
          **Formatting Instructions:**
          - ${bold ? "Use markdown for bold (**text**) to emphasize key phrases." : "Do not use bold or italics."}
          - ${headings ? "Use clear headings for the main steps (HOOK, PROMISE, etc.)." : "Do not use special headings."}

          **Final Check:** Before outputting, you MUST verify that you have followed the "Addictive Video Formula", respected the output format for each part, and met the word count.
          
          Please generate the complete video script now.
        `;
    }

    try {
        return await callApi(prompt, provider, model);
    } catch (error) {
        throw handleApiError(error, 'tạo kịch bản');
    }
};

export const generateScriptOutline = async (params: GenerationParams, provider: AiProvider, model: string): Promise<string> => {
    const { title, outlineContent, targetAudience, wordCount } = params;
    const language = targetAudience;
    const prompt = `
        You are an expert YouTube scriptwriter and content strategist.
        Your task is to generate a detailed and well-structured outline for a long-form YouTube video.
        **Video Title:** "${title}"
        **User's Initial Outline/Notes (if any):** "${outlineContent || 'None'}"
        **Target Language:** ${language}
        **Target Script Length:** Approximately ${wordCount} words.
        **Instructions:**
        1.  Create a comprehensive outline that breaks the topic down into a logical sequence (e.g., Introduction, Part 1, Part 2, ..., Conclusion).
        2.  If the user provided an initial outline, use it as the primary guide and expand upon it.
        3.  For each main part, include key talking points, sub-topics, or questions that should be answered.
        4.  The structure should be clear and easy to follow, serving as a roadmap for writing the full script later.
        5.  Suggest where engagement hooks (like a surprising fact or an open question) could be placed to maximize viewer retention.
        6.  Ensure the outline is detailed enough to guide the creation of a script that meets the target word count.
        7.  The entire response should be in ${language}. Use markdown headings starting from ## for parts.
        **Output Format:** Provide ONLY the outline, using markdown for headings, subheadings, and bullet points for clarity. Start directly with the outline.
        Example:
        ## I. Mở Đầu (Intro)
        -   Gây ấn tượng mạnh, nêu ra câu hỏi trung tâm.
        -   Giới thiệu ngắn gọn về chủ đề và tầm quan trọng của nó.
        -   Hứa hẹn giá trị mà người xem sẽ nhận được.
        ---
        Now, please generate the outline for the specified topic.
    `;

    try {
        const outline = await callApi(prompt, provider, model);
        const userGuide = `### Dàn Ý Chi Tiết Cho Kịch Bản Dài\n\n**Gợi ý:** Kịch bản của bạn dài hơn 1000 từ. Đây là dàn ý chi tiết AI đã tạo ra. Bạn có thể sử dụng nút "Tạo kịch bản đầy đủ" bên dưới để AI tự động viết từng phần cho bạn.\n\n---\n\n`;
        return userGuide + outline;
    } catch (error) {
        throw handleApiError(error, 'tạo dàn ý');
    }
};

export const generateTopicSuggestions = async (theme: string, provider: AiProvider, model: string): Promise<TopicSuggestionItem[]> => {
    if (!theme.trim()) return [];
    const prompt = `Based on the central theme "${theme}", generate exactly 5 specific, engaging, and SEO-friendly YouTube video ideas in Vietnamese. Each idea must include a 'title' (a catchy title) and an 'outline' (a 2-3 sentence summary of the key points for the video).
    You must output a valid JSON object with a single key "suggestions" which is an array of these 5 ideas.
    Example format: {"suggestions": [{"title": "...", "outline": "..."}, ...]}
    `;

    try {
        const responseText = await callApi(prompt, provider, model, true);
        const jsonResponse = JSON.parse(responseText);
        const suggestions: TopicSuggestionItem[] = jsonResponse.suggestions;
        if (!Array.isArray(suggestions) || suggestions.some(s => typeof s.title !== 'string' || typeof s.outline !== 'string')) {
             throw new Error("AI returned data in an unexpected format.");
        }
        return suggestions;

    } catch (error) {
        throw handleApiError(error, 'tạo gợi ý chủ đề');
    }
};

export const parseIdeasFromFile = async (fileContent: string, provider: AiProvider, model: string): Promise<TopicSuggestionItem[]> => {
    if (!fileContent.trim()) return [];
    const prompt = `
        You are a data extraction assistant. Your task is to parse the provided text content, which contains a list of YouTube video ideas, and convert it into a structured JSON format.
        The text may contain original titles in other languages and Vietnamese titles.

        **Input Text:**
        """
        ${fileContent}
        """

        **Instructions:**
        1.  Carefully analyze the text and identify each distinct idea block.
        2.  For each block, extract the following:
            -   **'title'**: This MUST be the original title. Look for patterns like "> Tiêu đề (Original):". If an original title is not found, use the Vietnamese title as the main title.
            -   **'vietnameseTitle'**: This MUST be the Vietnamese title. Look for patterns like "> Tiêu đề (Tiếng Việt):". If only one title is present, use it for both 'title' and 'vietnameseTitle'.
            -   **'outline'**: Extract the multi-line text that constitutes the outline (usually after "> Nội dung phác họa:").
        3.  The final output MUST be a JSON array of objects. Each object must have a 'title', 'vietnameseTitle', and 'outline' key.
        4.  If the input text is empty, malformed, or contains no recognizable ideas, return an empty JSON array.
        5.  The output must be ONLY the JSON array, nothing else.

        Please generate the JSON array now.
    `;
    
    try {
        const responseText = await callApi(prompt, provider, model, true);
        const jsonResponse = JSON.parse(responseText);
        if (Array.isArray(jsonResponse)) {
            return jsonResponse as TopicSuggestionItem[];
        }
        throw new Error("AI returned data in an unexpected format.");

    } catch (error) {
        throw handleApiError(error, 'phân tích tệp ý tưởng');
    }
};

export const generateKeywordSuggestions = async (title: string, outlineContent: string, provider: AiProvider, model: string): Promise<string[]> => {
    if (!title.trim()) return [];
    const prompt = `Based on the video title "${title}" and the outline "${outlineContent}", generate at least 5 relevant, SEO-friendly keywords. The keywords should be in Vietnamese.
    You must output a valid JSON object with a single key "keywords" which is an array of strings.
    Example format: {"keywords": ["keyword1", "keyword2", ...]}
    `;

    try {
        const responseText = await callApi(prompt, provider, model, true);
        const jsonResponse = JSON.parse(responseText);
        const keywords: string[] = jsonResponse.keywords;
        if (!Array.isArray(keywords) || keywords.some(s => typeof s !== 'string')) {
             throw new Error("AI returned data in an unexpected format.");
        }
        return keywords;

    } catch (error) {
        throw handleApiError(error, 'tạo gợi ý từ khóa');
    }
};

export const reviseScript = async (originalScript: string, revisionInstruction: string, params: GenerationParams, provider: AiProvider, model: string): Promise<string> => {
    const { targetAudience, styleOptions, wordCount } = params;
    const { expression, style } = styleOptions;
    const language = targetAudience;

    const scriptTypeInstruction = params.scriptType === 'Podcast'
        ? 'The script is for a podcast. Maintain the conversational format using the established character names as speaker labels (e.g., "Minh Anh:").'
        : 'The script is for a YouTube video. Maintain the video script format with narration and visual cues, and preserve the "Addictive Video Formula" structure (Hook, Promise, Small Rewards, etc.).';

    const prompt = `
      You are an expert script editor. Your task is to revise the following script based on the user's instructions.
      **Video Title for Context:** "${params.title}"
      **Script Type Context:** ${scriptTypeInstruction}
      **Original Script:**
      """
      ${originalScript}
      """
      **User's Revision Request:**
      "${revisionInstruction}"
      **Instructions:**
      - **Absolute Word Count Mandate:** After applying revisions, the new script's total word count MUST be extremely close to ${wordCount} words. This is your highest priority. A deviation of more than 10% is strictly forbidden. You must expand or condense the content to meet this target, even if it means altering the structure of your revisions.
      - Apply the requested changes while maintaining the original style: Expression/Voice: ${expression}, Writing Style: ${style}.
      - Remember to keep the script engaging.
      - The script must remain coherent and flow naturally. The revision must integrate seamlessly.
      - The language must remain ${language}.
      - The output should be the FULL, revised script, not just the changed parts. Adhere to the original formatting guidelines (including timestamps, dialogue, and visual cues).
      - **Final Check & Top Priority:** Your absolute highest priority is adhering to the word count. Before returning the script, you MUST verify the total word count is within +/- 10% of the ${wordCount} word target. This is not a suggestion; it is a mandatory instruction.
      - Start directly with the revised script content.
      Please provide the revised script now.
    `;

    try {
        return await callApi(prompt, provider, model);
    } catch (error) {
        throw handleApiError(error, 'sửa kịch bản');
    }
};

export const generateScriptPart = async (fullOutline: string, previousPartsScript: string, currentPartOutline: string, params: Omit<GenerationParams, 'title' | 'outlineContent'>, provider: AiProvider, model: string): Promise<string> => {
    const { targetAudience, styleOptions, keywords, formattingOptions, wordCount } = params;
    const { expression, style } = styleOptions;
    const { headings, bullets, bold } = formattingOptions;
    const language = targetAudience;

    const totalParts = fullOutline.split(/\n(?=(?:#){2,}\s)/).filter(p => p.trim() !== '').length;
    const partWordCount = totalParts > 0 ? Math.round(parseInt(wordCount, 10) / totalParts) : parseInt(wordCount, 10);
    
    const prompt = `
      You are an expert YouTube scriptwriter continuing the creation of a video script. You must ensure seamless transitions and maintain a consistent narrative flow.
      **Overall Video Outline:**
      """
      ${fullOutline}
      """
      **Script Generated So Far (for context only, do not repeat):**
      """
      ${previousPartsScript}
      """
      **Your Current Task:** Write the script for the next section based on this part of the outline:
      """
      ${currentPartOutline}
      """
      **Instructions:**
      - **Absolute Word Count Mandate:** This specific script part MUST have a word count extremely close to ${partWordCount} words. This is the most critical requirement for this task. Adhere to a strict +/- 10% tolerance. Adjust the level of detail, verbosity, and sentence structure to hit this target precisely. Failure to meet this word count is a failure of the entire task.
      - Write ONLY the script for the current part described in the task.
      - **Crucial:** Ensure the beginning of this part connects smoothly with the end of the previously generated script.
      - Strictly adhere to the established style guide: Expression/Voice: ${expression}, Writing Style: ${style}.
      - **Engagement Strategy:** Where appropriate for this specific part, incorporate engaging elements like surprising facts, twists, or open-ended questions to maintain viewer interest. Do not force them if they don't fit naturally.
      - The language must remain ${language}.
      - If provided, naturally integrate these keywords: "${keywords || 'None'}".
      - Formatting: ${headings ? "Use headings if needed." : ""} ${bullets ? "Use lists if needed." : ""} ${bold ? "Use bold/italics if needed." : ""}
      - The final output should be ONLY the text for the current part, starting directly with its content (including its heading from the outline).
      - **Final Check & Top Priority:** Your primary objective is word count adherence for this section. Before finalizing the text, confirm it is strictly between ${Math.round(partWordCount * 0.9)} and ${Math.round(partWordCount * 1.1)} words. Do not fail this instruction.
      Generate the script for the current part now.
    `;
    
    try {
        return await callApi(prompt, provider, model);
    } catch (error) {
        throw handleApiError(error, 'tạo phần kịch bản tiếp theo');
    }
};

export const extractDialogue = async (script: string, language: string, provider: AiProvider, model: string): Promise<Record<string, string>> => {
    const prompt = `
      You are an AI assistant specializing in processing scripts for Text-to-Speech (TTS).
      Your task is to analyze the following script, which is divided into sections by markdown headings (e.g., ##, ###), and extract ONLY the spoken dialogue for each section.

      **Input Script:**
      """
      ${script}
      """

      **Instructions:**
      1.  **Identify Sections:** Parse the script and identify each distinct section. A section starts with a markdown heading. If there is content before the first heading, label that section "Mở đầu".
      2.  **Extract Spoken Text:** For each identified section, extract only the dialogue or narration.
      3.  **Remove Non-Spoken Elements:** You MUST remove all non-spoken elements: speaker labels (e.g., "Host:"), section headings themselves from the content, timestamps, visual cues (e.g., "Gợi ý hình ảnh/cử chỉ:"), sound cues (e.g., "[upbeat music]"), markdown formatting, and comments.
      4.  **JSON Output:** The final output MUST be a valid JSON object. The keys of the object should be the section titles (e.g., "Mở đầu", "Phần 1: Lịch sử AI"), and the values should be the clean dialogue text for that corresponding section.
      5.  **Language:** The output text must be in the original language of the script, which is ${language}.
      6.  Output ONLY the JSON object and nothing else.

      Example Output:
      {
        "Mở đầu": "Chào mừng các bạn đã quay trở lại kênh của chúng tôi. Hôm nay, chúng ta sẽ khám phá một chủ đề vô cùng thú vị.",
        "Phần 1: Khái niệm cơ bản": "Trí tuệ nhân tạo, hay AI, không phải là một khái niệm mới. Nó đã xuất hiện từ nhiều thập kỷ trước..."
      }

      Please provide the JSON object now.
    `;

    try {
        const responseText = await callApi(prompt, provider, model, true);
        const jsonResponse = JSON.parse(responseText);
        if (typeof jsonResponse === 'object' && jsonResponse !== null) {
            return jsonResponse;
        }
        throw new Error("AI returned data in an unexpected format. Expected a JSON object.");
    } catch (error) {
        throw handleApiError(error, 'tách lời thoại');
    }
};

export const generateVisualPrompt = async (sceneDescription: string, provider: AiProvider, model: string): Promise<VisualPrompt> => {
    const prompt = `
        You are a visual director. Based on the following script scene, create a concise, descriptive, and evocative prompt in English for an AI image or video generator (like Veo or Flow).
        The prompt should focus on visual elements: setting, characters, actions, mood, and camera style.
        Also, provide a Vietnamese translation for the prompt.
        You must output ONLY a valid JSON object with two keys: "english" and "vietnamese".

        **Script Scene:**
        """
        ${sceneDescription}
        """
    `;

    try {
        const responseText = await callApi(prompt, provider, model, true);
        const jsonResponse = JSON.parse(responseText);
        if (typeof jsonResponse.english === 'string' && typeof jsonResponse.vietnamese === 'string') {
            return jsonResponse;
        } else {
            throw new Error("AI returned data in an unexpected format.");
        }
    } catch (error) {
        throw handleApiError(error, 'tạo prompt hình ảnh');
    }
};

export const generateAllVisualPrompts = async (script: string, provider: AiProvider, model: string): Promise<AllVisualPromptsResult[]> => {
    const prompt = `
        You are a visual director AI. Your task is to analyze the following YouTube script, which is divided into sections by markdown headings (## or ###), and generate a concise, descriptive visual prompt in English for an AI image/video generator for EACH section. Also provide a Vietnamese translation for each prompt.

        **Input Script:**
        """
        ${script}
        """

        **Instructions:**
        1. Identify each distinct section/scene in the script, using the markdown headings as delimiters.
        2. For each section, create one visual prompt.
        3. The prompt should focus on visual elements: setting, characters, actions, mood, and camera style.
        4. The final output must be a JSON array. Each element in the array should be an object with three keys: "scene" (containing the original text of the script section), "english" (the English prompt), and "vietnamese" (the Vietnamese translation).
        5. The output must be ONLY the JSON array, nothing else.

        Please generate the JSON array now.
    `;

    try {
        const responseText = await callApi(prompt, provider, model, true);
        const jsonResponse = JSON.parse(responseText);
        if (Array.isArray(jsonResponse)) {
            return jsonResponse as AllVisualPromptsResult[];
        } else {
            throw new Error("AI returned data in an unexpected format.");
        }
    } catch (error) {
        throw handleApiError(error, 'tạo tất cả prompt hình ảnh');
    }
};

export const summarizeScriptForScenes = async (
    script: string, 
    provider: AiProvider, 
    model: string, 
    config: SummarizeConfig
): Promise<ScriptPartSummary[]> => {
    const { numberOfPrompts, includeNarration } = config;

    const quantityInstruction = typeof numberOfPrompts === 'number'
        ? `You MUST generate exactly ${numberOfPrompts} total scenes for the entire script.`
        : `Each scene must be designed to be approximately 8 seconds long. You decide the total number of scenes based on the script's length.`;

    const narrationInstruction = includeNarration
        ? `The final video WILL include the narrator's voice. The 'visualPrompt' should complement the spoken words, illustrating what is being said.`
        : `The final video will NOT have narration, only background music and sound effects. The storytelling must be purely visual.
- **CRITICAL RULE:** The 'visualPrompt' MUST NOT describe any person speaking, narrating, or lipsyncing. The generated video should be completely free of human speech.
- **Visual Storytelling First:** The 'visualPrompt' must be extremely descriptive, focusing on powerful imagery, actions, symbolism, and atmosphere to convey the story and information from the script's summary.
- **Minimize On-Screen Text:** AVOID suggesting on-screen text. Only include suggestions for on-screen text (e.g., 'On-screen text appears: ...') as a last resort, if a key piece of information is absolutely impossible to convey visually. The default should be NO on-screen text.`;
    
    const prompt = `
        You are an expert video production assistant. Your task is to break down the following YouTube script into a series of detailed scenes.
        The script is organized into main parts using markdown headings (## or ###).

        **Input Script:**
        """
        ${script}
        """

        **CRITICAL INSTRUCTIONS:**
        1.  **Source Material:** Your primary source for generating the 'summary' and 'visualPrompt' MUST be the "Lời thoại" (Narration) and "Gợi ý hình ảnh/cử chỉ" (Visual Cues) provided in the script for that section. Faithfully translate the script's intent into visual scenes. Do not invent new concepts.
        2.  **Scene Quantity:** ${quantityInstruction}
        3.  **Narration Context:** ${narrationInstruction}
        4.  **Output Structure:**
            -   For each main part identified by a heading, create a list of scenes.
            -   For each scene, you MUST provide:
                - A short 'summary' in Vietnamese, describing the key action or information for that segment. This is based on the script's content.
                - A detailed 'visualPrompt' in English for an AI video generator (like Veo). This prompt must visually represent the summary and follow the narration context above. It must describe setting, characters, action, mood, and camera style.
        5.  **JSON Format:** The final output MUST be a JSON array. Each object in the array represents a main part of the script and must have a 'partTitle' (the heading text) and a 'scenes' array. Each object in the 'scenes' array must have 'sceneNumber' (starting from 1 for the whole script), 'summary', and 'visualPrompt'.
        6.  The output must be ONLY the JSON array, nothing else.

        Please generate the JSON array now.
    `;

    try {
        const responseText = await callApi(prompt, provider, model, true);
        const jsonResponse = JSON.parse(responseText);
        if (Array.isArray(jsonResponse)) {
             // Re-number scenes sequentially from 1 across all parts
            let sceneCounter = 1;
            const renumberedSummary = jsonResponse.map(part => ({
                ...part,
                scenes: part.scenes.map((scene: any) => ({
                    ...scene,
                    sceneNumber: sceneCounter++
                }))
            }));
            return renumberedSummary as ScriptPartSummary[];
        } else {
            throw new Error("AI returned data in an unexpected format.");
        }
    } catch (error) {
        throw handleApiError(error, 'tóm tắt kịch bản ra các cảnh');
    }
};

export const suggestStyleOptions = async (title: string, outlineContent: string, provider: AiProvider, model: string): Promise<StyleOptions> => {
    const expressionValues = EXPRESSION_OPTIONS.map(o => o.value);
    const styleValues = STYLE_OPTIONS.map(o => o.value);

    const prompt = `
        You are an expert YouTube content strategist. Based on the video title and outline provided, your task is to suggest the most suitable Expression and Style for the script.

        **Video Title:** "${title}"
        **Video Outline/Description:** "${outlineContent}"

        You MUST choose exactly one option for each category from the provided lists.

        **Available Expressions:**
        - ${expressionValues.join('\n- ')}

        **Available Styles:**
        - ${styleValues.join('\n- ')}

        Analyze the topic and return a JSON object with two keys: "expression", and "style". The values for these keys must be one of the exact strings from the lists above. For example, if the topic is a vlog, you might suggest 'Conversational' expression and 'Narrative' style.
        The output must be ONLY the JSON object, nothing else.
    `;

    try {
        const responseText = await callApi(prompt, provider, model, true);
        const jsonResponse = JSON.parse(responseText);
        
        if (
            expressionValues.includes(jsonResponse.expression) &&
            styleValues.includes(jsonResponse.style)
        ) {
            return jsonResponse as StyleOptions;
        } else {
            console.error("AI returned invalid style options:", jsonResponse);
            throw new Error("AI đã trả về các tùy chọn phong cách không hợp lệ.");
        }
    } catch (error) {
        throw handleApiError(error, 'gợi ý phong cách');
    }
};

export const scoreScript = async (script: string, title: string, provider: AiProvider, model: string): Promise<string> => {
    const prompt = `
        Bạn là một chuyên gia chấm điểm kịch bản điện ảnh, có nhiệm vụ đánh giá trung thực và khắt khe.
        Hãy đọc toàn bộ kịch bản dưới đây, hiểu rõ cấu trúc, cảm xúc, thông điệp và phong cách kể.

        **Tiêu đề kịch bản:** "${title}"
        **Nội dung kịch bản:**
        """
        ${script}
        """

        **YÊU CẦU BẮT BUỘC:**
        Bạn PHẢI trình bày bài đánh giá theo đúng định dạng markdown sau, không thêm bớt bất kỳ mục nào. Giọng văn phải chuyên nghiệp, có chiều sâu phê bình, và khắt khe.

        ### Bảng Đánh Giá Kịch Bản

        🧩 **1. Kết cấu và mạch cảm xúc**
        - **Điểm:** [Chấm điểm trên thang 10, ví dụ: 8.5/10]
        - **Phân tích:** [Phân tích ngắn gọn, súc tích, có trích dẫn từ kịch bản để minh họa.]

        📚 **2. Độ chính xác & nghiên cứu**
        - **Điểm:** [Chấm điểm trên thang 10]
        - **Phân tích:** [Đánh giá tính logic, độ tin cậy của thông tin nếu có, hoặc tính nhất quán của thế giới nội tại trong kịch bản.]

        ✍️ **3. Giọng văn & phong cách kể**
        - **Điểm:** [Chấm điểm trên thang 10]
        - **Phân tích:** [Nhận xét về lối hành văn, sự độc đáo, và hiệu quả của phong cách kể chuyện được chọn.]

        💡 **4. Ý tưởng và chiều sâu tư tưởng**
        - **Điểm:** [Chấm điểm trên thang 10]
        - **Phân tích:** [Đánh giá tính nguyên bản, thông điệp, và tầm vóc của ý tưởng cốt lõi.]

        🪶 **5. Cấu trúc, nhịp đọc và sức nặng hình ảnh**
        - **Điểm:** [Chấm điểm trên thang 10]
        - **Phân tích:** [Đánh giá nhịp điệu của kịch bản, cách xây dựng cảnh, và tiềm năng chuyển thể thành hình ảnh điện ảnh.]

        ---

        🏅 **Tổng điểm:** [Tính điểm trung bình của 5 tiêu chí, làm tròn đến 1 chữ số thập phân]/10
        **Nhận định tổng quát:** [Một đoạn nhận xét chung về kịch bản, tiềm năng và phong cách.]

        🎬 **Gợi ý cải thiện:**
        - [Gạch đầu dòng 1: Đề xuất cụ thể, thực tế để cải thiện kịch bản.]
        - [Gạch đầu dòng 2: Đề xuất tiếp theo.]
        - [Gạch đầu dòng 3: ...]

        Hãy bắt đầu bài đánh giá ngay bây giờ.
    `;

    try {
        return await callApi(prompt, provider, model, false);
    } catch (error) {
        throw handleApiError(error, 'chấm điểm kịch bản');
    }
};

export const getElevenlabsVoices = async (): Promise<ElevenlabsVoice[]> => {
    try {
        const apiKey = getApiKey('elevenlabs');
        const response = await fetch('https://api.elevenlabs.io/v1/voices', {
            headers: { 'xi-api-key': apiKey }
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(JSON.stringify(errorData));
        }
        const data = await response.json();
        return data.voices as ElevenlabsVoice[];
    } catch (error) {
        throw handleApiError(error, 'lấy danh sách giọng nói từ ElevenLabs');
    }
}

export const generateElevenlabsTts = async (text: string, voiceId: string): Promise<string> => {
    if (!text || !voiceId) {
        throw new Error("Cần có văn bản và ID giọng nói để tạo âm thanh.");
    }
    try {
        const apiKey = getApiKey('elevenlabs');
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'xi-api-key': apiKey,
                'accept': 'audio/mpeg'
            },
            body: JSON.stringify({
                text: text,
                model_id: 'eleven_multilingual_v2',
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.75
                }
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText);
        }

        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        return audioUrl;
    } catch (error) {
        throw handleApiError(error, 'tạo âm thanh từ ElevenLabs');
    }
}
