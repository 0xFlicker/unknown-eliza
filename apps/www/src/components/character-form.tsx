import ArrayInput from "@/components/array-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  AVATAR_IMAGE_MAX_SIZE,
  FIELD_REQUIREMENT_TYPE,
  FIELD_REQUIREMENTS,
} from "@/constants";
import { useToast } from "@/hooks/use-toast";
import { exportCharacterAsJson } from "@/lib/export-utils";
import { compressImage } from "@/lib/utils";
import type { Agent } from "@elizaos/core";
import type React from "react";
import {
  type FormEvent,
  type ReactNode,
  useState,
  useMemo,
  useCallback,
  useRef,
  useEffect,
} from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getAllVoiceModels,
  getVoiceModelByValue,
  providerPluginMap,
} from "../config/voice-models";
import { useElevenLabsVoices } from "@/hooks/use-elevenlabs-voices";
import {
  Trash,
  Loader2,
  RotateCcw,
  Download,
  Upload,
  Save,
  StopCircle,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { agentTemplates, getTemplateById } from "@/config/agent-templates";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { SplitButton } from "@/components/ui/split-button";

export type InputField = {
  name: string;
  title: string;
  description?: string;
  fieldType: "text" | "textarea" | "email" | "url" | "checkbox" | "select";
  getValue: (agent: Agent) => string;
  options?: { value: string; label: string }[];
  tooltip?: string;
};

export type ArrayField = {
  path: string;
  title: string;
  description?: string;
  getData: (agent: Agent) => string[];
  tooltip?: string;
};

enum SECTION_TYPE {
  INPUT = "input",
  ARRAY = "array",
}

type customComponent = {
  name: string;
  component: ReactNode;
};

export type CharacterFormProps = {
  title: string;
  description: string;
  onSubmit: (character: Agent) => Promise<void>;
  onDelete?: () => void;
  onReset?: () => void;
  onStopAgent?: () => void;
  isAgent?: boolean;
  isDeleting?: boolean;
  isStopping?: boolean;
  customComponents?: customComponent[];
  characterValue: Agent;
  setCharacterValue: {
    updateField: <T>(path: string, value: T) => void;
    addArrayItem?: <T>(path: string, item: T) => void;
    removeArrayItem?: (path: string, index: number) => void;
    updateSetting?: (path: string, value: any) => void;
    importAgent?: (value: Agent) => void;
    [key: string]: any;
  };
};

// Custom hook to detect container width and determine if labels should be shown
const useContainerWidth = (threshold: number = 768) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showLabels, setShowLabels] = useState(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        setShowLabels(width >= threshold);
      }
    });

    resizeObserver.observe(container);

    // Initial check
    const { width } = container.getBoundingClientRect();
    setShowLabels(width >= threshold);

    return () => resizeObserver.disconnect();
  }, [threshold]);

  return { containerRef, showLabels };
};

export default function CharacterForm({
  characterValue,
  setCharacterValue,
  title,
  description,
  onSubmit,
  onDelete,
  onReset,
  onStopAgent,
  isDeleting = false,
  isStopping = false,
  customComponents = [],
}: CharacterFormProps) {
  const { toast } = useToast();
  const { data: elevenlabsVoices, isLoading: isLoadingVoices } =
    useElevenLabsVoices();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string>("none");
  const [activeTab, setActiveTab] = useState("basic");
  const tabsContainerRef = useRef<HTMLDivElement>(null);
  const [showLeftScroll, setShowLeftScroll] = useState(false);
  const [showRightScroll, setShowRightScroll] = useState(false);

  // Use the custom hook to detect container width
  const { containerRef, showLabels } = useContainerWidth(640); // Adjust threshold as needed

  // Check if tabs need scroll buttons
  const checkScrollButtons = useCallback(() => {
    const container = tabsContainerRef.current;
    if (!container) return;

    const { scrollLeft, scrollWidth, clientWidth } = container;
    setShowLeftScroll(scrollLeft > 0);
    setShowRightScroll(scrollLeft + clientWidth < scrollWidth - 1);
  }, []);

  useEffect(() => {
    const container = tabsContainerRef.current;
    if (!container) return;

    checkScrollButtons();
    container.addEventListener("scroll", checkScrollButtons);
    window.addEventListener("resize", checkScrollButtons);

    return () => {
      container.removeEventListener("scroll", checkScrollButtons);
      window.removeEventListener("resize", checkScrollButtons);
    };
  }, [checkScrollButtons, customComponents.length]);

  const scrollTabs = (direction: "left" | "right") => {
    const container = tabsContainerRef.current;
    if (!container) return;

    const scrollAmount = container.clientWidth * 0.8;
    container.scrollBy({
      left: direction === "left" ? -scrollAmount : scrollAmount,
      behavior: "smooth",
    });
  };

  // Get all voice models, using the dynamic ElevenLabs voices when available
  const allVoiceModels = useMemo(() => {
    const staticModels = getAllVoiceModels();

    // If we have dynamically loaded ElevenLabs voices, replace the static ones
    if (elevenlabsVoices && !isLoadingVoices) {
      // Filter out the static ElevenLabs voices
      const nonElevenLabsModels = staticModels.filter(
        (model) => model.provider !== "elevenlabs",
      );
      // Return combined models with dynamic ElevenLabs voices
      return [...nonElevenLabsModels, ...elevenlabsVoices];
    }

    // Otherwise return the static models
    return staticModels;
  }, [elevenlabsVoices, isLoadingVoices]);

  // Define form schema with dynamic voice model options
  const AGENT_FORM_SCHEMA = useMemo(
    () => [
      {
        sectionTitle: "Basic Info",
        sectionValue: "basic",
        sectionType: SECTION_TYPE.INPUT,
        fields: [
          {
            title: "Name",
            name: "name",
            description: "The primary identifier for this agent",
            fieldType: "text",
            getValue: (char) => char.name || "",
            tooltip:
              "Display name that will be visible to users. Required for identification purposes.",
          },
          {
            title: "Username",
            name: "username",
            description: "Used in URLs and API endpoints",
            fieldType: "text",
            getValue: (char) => char.username || "",
            tooltip:
              "Unique identifier for your agent. Used in APIs/URLs and Rooms.",
          },
          {
            title: "System",
            name: "system",
            description: "System prompt defining agent behavior",
            fieldType: "textarea",
            getValue: (char) => char.system || "",
            tooltip:
              "Instructions for the AI model that establish core behavior patterns and personality traits.",
          },
          {
            title: "Voice Model",
            name: "settings.voice.model",
            description: "Voice model for audio synthesis",
            fieldType: "select",
            getValue: (char) => char.settings?.voice?.model || "",
            options: allVoiceModels.map((model) => ({
              value: model.value,
              label: model.label,
            })),
            tooltip:
              "Select a voice that aligns with the agent's intended persona.",
          },
        ] as InputField[],
      },
      {
        sectionTitle: "Content",
        sectionValue: "content",
        sectionType: SECTION_TYPE.ARRAY,
        fields: [
          {
            title: "Bio",
            description: "Bio data for this agent",
            path: "bio",
            getData: (char) => (Array.isArray(char.bio) ? char.bio : []),
            tooltip:
              "Biographical details that establish the agent's background and context.",
          },
          {
            title: "Topics",
            description: "Topics this agent can talk about",
            path: "topics",
            getData: (char) => char.topics || [],
            tooltip: "Subject domains the agent can discuss with confidence.",
          },
          {
            title: "Adjectives",
            description: "Descriptive personality traits",
            path: "adjectives",
            getData: (char) => char.adjectives || [],
            tooltip:
              "Key personality attributes that define the agent's character.",
          },
        ] as ArrayField[],
      },
      {
        sectionTitle: "Style",
        sectionValue: "style",
        sectionType: SECTION_TYPE.ARRAY,
        fields: [
          {
            title: "All Styles",
            description: "Writing style for all content types",
            path: "style.all",
            getData: (char) => char.style?.all || [],
            tooltip:
              "Core writing style guidelines applied across all content formats.",
          },
          {
            title: "Chat Style",
            description: "Style specific to chat interactions",
            path: "style.chat",
            getData: (char) => char.style?.chat || [],
            tooltip: "Writing style specific to conversational exchanges.",
          },
          {
            title: "Post Style",
            description: "Style for long-form content",
            path: "style.post",
            getData: (char) => char.style?.post || [],
            tooltip:
              "Writing style for structured content such as articles or posts.",
          },
        ] as ArrayField[],
      },
    ],
    [allVoiceModels],
  );

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked;

    if (type === "checkbox") {
      setCharacterValue.updateField(name, checked);
    } else if (name.startsWith("settings.")) {
      // Handle nested settings fields like settings.voice.model
      const path = name.substring(9); // Remove 'settings.' prefix

      if (setCharacterValue.updateSetting) {
        // Use the specialized method if available
        setCharacterValue.updateSetting(path, value);
      } else {
        // Fall back to generic updateField
        setCharacterValue.updateField(name, value);
      }
    } else {
      setCharacterValue.updateField(name, value);
    }
  };

  const handleVoiceModelChange = (value: string, name: string) => {
    if (name.startsWith("settings.")) {
      const path = name.substring(9); // Remove 'settings.' prefix

      if (setCharacterValue.updateSetting) {
        // Use the specialized method if available
        setCharacterValue.updateSetting(path, value);

        // Handle voice model change and required plugins
        if (path === "voice.model" && value) {
          const voiceModel = getVoiceModelByValue(value);
          if (voiceModel) {
            const currentPlugins = Array.isArray(characterValue.plugins)
              ? [...characterValue.plugins]
              : [];
            const previousVoiceModel = getVoiceModelByValue(
              characterValue.settings?.voice?.model,
            );

            // Get the required plugin for the new voice model
            const requiredPlugin = providerPluginMap[voiceModel.provider];

            // Add the required plugin for the selected voice model
            const newPlugins = [...currentPlugins];
            if (requiredPlugin && !currentPlugins.includes(requiredPlugin)) {
              newPlugins.push(requiredPlugin);
            }

            // Update the plugins
            if (setCharacterValue.setPlugins) {
              setCharacterValue.setPlugins(newPlugins);
            } else if (setCharacterValue.updateField) {
              setCharacterValue.updateField("plugins", newPlugins);
            }

            // Show toast notification
            if (previousVoiceModel?.provider !== voiceModel.provider) {
              toast({
                title: "Plugin Updated",
                description: `${requiredPlugin} plugin has been set for the selected voice model.`,
              });
            }
          }
        }
      } else {
        // Fall back to generic updateField
        setCharacterValue.updateField(name, value);
      }
    } else {
      setCharacterValue.updateField(name, value);
    }
  };

  const updateArray = (path: string, newData: string[]) => {
    // If the path is a simple field name
    if (!path.includes(".")) {
      setCharacterValue.updateField(path, newData);
      return;
    }

    // Handle nested paths (e.g. style.all)
    const parts = path.split(".");
    if (parts.length === 2 && parts[0] === "style") {
      // For style arrays, use the setStyleArray method if available
      if (setCharacterValue.setStyleArray) {
        setCharacterValue.setStyleArray(
          parts[1] as "all" | "chat" | "post",
          newData,
        );
      } else {
        setCharacterValue.updateField(path, newData);
      }
      return;
    }

    // Default case - just update the field
    setCharacterValue.updateField(path, newData);
  };

  const ensureAvatarSize = async (char: Agent): Promise<Agent> => {
    if (char.settings?.avatar) {
      const img = new Image();
      img.src = char.settings.avatar;
      await new Promise((resolve) => (img.onload = resolve));

      if (
        img.width > AVATAR_IMAGE_MAX_SIZE ||
        img.height > AVATAR_IMAGE_MAX_SIZE
      ) {
        const response = await fetch(char.settings.avatar);
        const blob = await response.blob();
        const file = new File([blob], "avatar.jpg", { type: blob.type });
        const compressedImage = await compressImage(file);
        return {
          ...char,
          settings: {
            ...char.settings,
            avatar: compressedImage,
          },
        };
      }
    }
    return char;
  };

  const handleFormSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const updatedCharacter = await ensureAvatarSize(characterValue);
      await onSubmit(updatedCharacter);
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to update agent",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderInputField = (field: InputField) => (
    <div
      key={field.name}
      className={`space-y-2 w-full ${field.name === "name" ? "agent-form-name" : ""} ${field.name === "system" ? "agent-form-system-prompt" : ""}`}
    >
      <div className="flex items-center gap-2">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Label htmlFor={field.name} className="flex items-center gap-1">
                {field.title}
                {field.name in FIELD_REQUIREMENTS &&
                  (
                    FIELD_REQUIREMENTS as Record<string, FIELD_REQUIREMENT_TYPE>
                  )[field.name] === FIELD_REQUIREMENT_TYPE.REQUIRED && (
                    <p className="text-red-500">*</p>
                  )}
              </Label>
            </TooltipTrigger>
            {field.tooltip && (
              <TooltipContent>
                <p>{field.tooltip}</p>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      </div>

      {field.description && (
        <p className="text-sm text-muted-foreground">{field.description}</p>
      )}

      {field.fieldType === "textarea" ? (
        <Textarea
          id={field.name}
          name={field.name}
          value={field.getValue(characterValue)}
          onChange={handleChange}
          className="min-h-[120px] resize-y"
        />
      ) : field.fieldType === "checkbox" ? (
        <Input
          id={field.name}
          name={field.name}
          type="checkbox"
          checked={
            (characterValue as Record<string, any>)[field.name] === "true"
          }
          onChange={handleChange}
        />
      ) : field.fieldType === "select" ? (
        <Select
          name={field.name}
          value={field.getValue(characterValue)}
          onValueChange={(value) => handleVoiceModelChange(value, field.name)}
        >
          <SelectTrigger>
            <SelectValue
              placeholder={
                field.name.includes("voice.model") && isLoadingVoices
                  ? "Loading voice models..."
                  : "Select a voice model"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {field.options?.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          id={field.name}
          name={field.name}
          type={field.fieldType}
          value={field.getValue(characterValue)}
          onChange={handleChange}
        />
      )}
    </div>
  );

  const renderArrayField = (field: ArrayField) => (
    <div key={field.path} className="space-y-2">
      <div className="flex items-center gap-2">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Label htmlFor={field.path} className="flex items-center gap-1">
                {field.title}
                {field.path in FIELD_REQUIREMENTS &&
                  (
                    FIELD_REQUIREMENTS as Record<string, FIELD_REQUIREMENT_TYPE>
                  )[field.path] === FIELD_REQUIREMENT_TYPE.REQUIRED && (
                    <p className="text-red-500">*</p>
                  )}
              </Label>
            </TooltipTrigger>
            {field.tooltip && (
              <TooltipContent>
                <p>{field.tooltip}</p>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      </div>
      {field.description && (
        <p className="text-sm text-muted-foreground">{field.description}</p>
      )}
      <ArrayInput
        data={field.getData(characterValue)}
        onChange={(newData) => updateArray(field.path, newData)}
      />
    </div>
  );

  const handleExportJSON = () => {
    exportCharacterAsJson(characterValue, toast);
  };

  const handleImportJSON = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const json: Agent = JSON.parse(text);

      // Check for required fields using FIELD_REQUIREMENTS
      const missingFields = (
        Object.keys(FIELD_REQUIREMENTS) as Array<
          keyof typeof FIELD_REQUIREMENTS
        >
      ).filter((field) => {
        if (FIELD_REQUIREMENTS[field] !== FIELD_REQUIREMENT_TYPE.REQUIRED)
          return false;

        // Handle nested fields like style.all
        const parts = field.split(".");
        let current: any = json;

        for (const part of parts) {
          current = current?.[part];
          if (current === undefined) return true; // field missing
        }

        return false;
      });

      if (missingFields.length > 0) {
        toast({
          title: "Import Failed",
          description: `Missing required fields: ${missingFields.join(", ")}`,
          variant: "destructive",
        });
        return;
      }

      if (setCharacterValue.importAgent) {
        setCharacterValue.importAgent(json);
      } else {
        console.warn("Missing importAgent method");
      }

      toast({
        title: "Agent Imported",
        description: "Agent data has been successfully loaded.",
      });
    } catch (error) {
      toast({
        title: "Import Failed",
        description:
          error instanceof Error ? error.message : "Invalid JSON file",
        variant: "destructive",
      });
    } finally {
      event.target.value = "";
    }
  };

  // File input ref for import functionality
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  // Define stop/delete options (only if both are available)
  const stopDeleteOptions = useMemo(() => {
    const options = [];

    if (onStopAgent) {
      options.push({
        label: "Stop Agent",
        description: "Stop running",
        onClick: onStopAgent,
      });
    }

    if (onDelete) {
      options.push({
        label: "Delete Agent",
        description: "Delete permanently",
        onClick: () => onDelete(),
      });
    }

    return options;
  }, [onStopAgent, onDelete]);

  /**
   * Handle template selection
   */
  const handleTemplateChange = useCallback(
    (templateId: string) => {
      setSelectedTemplate(templateId);

      // If "None" is selected, reset to blank form if reset function is available
      if (templateId === "none" && onReset) {
        onReset();
        return;
      }

      // Get the template data
      const template = getTemplateById(templateId);
      if (template && setCharacterValue.importAgent) {
        // Use the importAgent function to set all template values at once
        setCharacterValue.importAgent(template.template as Agent);
      }
    },
    [onReset, setCharacterValue],
  );

  // Create all tabs data with better short labels
  const allTabs = [
    ...AGENT_FORM_SCHEMA.map((section) => ({
      value: section.sectionValue,
      label: section.sectionTitle,
      shortLabel: section.sectionTitle.split(" ")[0], // Use first word for mobile
    })),
    ...customComponents.map((component) => ({
      value: `custom-${component.name}`,
      label: component.name,
      shortLabel: (component as any).shortLabel || component.name.split(" ")[0], // Use first word
    })),
  ];

  return (
    <div ref={containerRef} className="w-full max-w-full mx-auto p-4 sm:p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">{title || "Agent Settings"}</h1>
          <p className="text-muted-foreground mt-1">
            {description || "Configure your agent settings"}
          </p>
        </div>
      </div>

      {/* Template Selector */}
      <div className="mb-6">
        <Label htmlFor="template-selector" className="text-base font-medium">
          Start with Template:
        </Label>
        <Select value={selectedTemplate} onValueChange={handleTemplateChange}>
          <SelectTrigger className="w-full mt-2">
            <SelectValue placeholder="Select a template" />
          </SelectTrigger>
          <SelectContent>
            {agentTemplates.map((template) => (
              <SelectItem key={template.id} value={template.id}>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="w-full text-left">{template.label}</span>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      <p className="max-w-xs">{template.description}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <form onSubmit={handleFormSubmit}>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="relative mb-6">
            {/* Scroll button left */}
            {showLeftScroll && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute left-0 top-1/2 -translate-y-1/2 z-10 h-8 w-8 p-0 bg-background/80 backdrop-blur-sm shadow-md"
                onClick={() => scrollTabs("left")}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            )}

            {/* Tabs container */}
            <div
              ref={tabsContainerRef}
              className="overflow-x-auto scrollbar-hide"
            >
              <TabsList className="inline-flex h-10 items-center justify-start rounded-md bg-muted p-1 text-muted-foreground w-full">
                {allTabs.map((tab) => (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    className={cn(
                      "whitespace-nowrap px-3 py-1.5 text-sm font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:rounded-md data-[state=active]:border-0",
                      !showLabels && "px-2 text-xs", // Smaller padding and text on mobile
                    )}
                  >
                    {showLabels ? tab.label : tab.shortLabel}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            {/* Scroll button right */}
            {showRightScroll && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-1/2 -translate-y-1/2 z-10 h-8 w-8 p-0 bg-background/80 backdrop-blur-sm shadow-md"
                onClick={() => scrollTabs("right")}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            )}
          </div>

          <Card>
            <CardContent className="p-6">
              {AGENT_FORM_SCHEMA.map((section) => (
                <TabsContent
                  key={section.sectionValue}
                  value={section.sectionValue}
                  className="space-y-6"
                >
                  {section.sectionType === SECTION_TYPE.INPUT
                    ? (section.fields as InputField[]).map(renderInputField)
                    : (section.fields as ArrayField[]).map(renderArrayField)}
                </TabsContent>
              ))}
              {customComponents.map((component) => (
                <TabsContent
                  key={`custom-${component.name}`}
                  value={`custom-${component.name}`}
                >
                  {component.component}
                </TabsContent>
              ))}
            </CardContent>
          </Card>
        </Tabs>

        <div className="flex flex-col gap-3 mt-6">
          {/* Stop/Delete Split Button - only show if we have options */}
          {stopDeleteOptions.length > 0 && (
            <SplitButton
              mainAction={{
                label:
                  stopDeleteOptions[0].label === "Stop Agent" && isStopping
                    ? "Stopping..."
                    : stopDeleteOptions[0].label,
                onClick: stopDeleteOptions[0].onClick,
                icon:
                  stopDeleteOptions[0].label === "Stop Agent" ? (
                    isStopping ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <StopCircle className="h-4 w-4" />
                    )
                  ) : (
                    <Trash className="h-4 w-4" />
                  ),
                disabled:
                  stopDeleteOptions[0].label === "Stop Agent"
                    ? isStopping
                    : false,
              }}
              actions={stopDeleteOptions.slice(1).map((option) => ({
                label:
                  option.label === "Stop Agent" && isStopping
                    ? "Stopping..."
                    : option.label,
                onClick: option.onClick,
                icon:
                  option.label === "Stop Agent" ? (
                    isStopping ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <StopCircle className="h-4 w-4" />
                    )
                  ) : (
                    <Trash className="h-4 w-4" />
                  ),
                variant: "destructive" as const,
                disabled: option.label === "Stop Agent" ? isStopping : false,
              }))}
              variant="destructive"
              disabled={isDeleting}
              className="w-full"
            />
          )}

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    onReset?.();
                  }}
                  className="w-full"
                >
                  <RotateCcw className="h-4 w-4" />
                  <span className="ml-2">Reset Changes</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Reset all form fields to their original values</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Import/Export Split Button */}
          <SplitButton
            mainAction={{
              label: "Export JSON",
              onClick: handleExportJSON,
              icon: <Download className="h-4 w-4" />,
            }}
            actions={[
              {
                label: "Import JSON",
                onClick: handleImportClick,
                icon: <Upload className="h-4 w-4" />,
              },
            ]}
            variant="outline"
            className="w-full"
          />

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="agent-form-submit w-full"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="ml-2">Saving...</span>
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4" />
                      <span className="ml-2">Save Changes</span>
                    </>
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Save all changes to the agent configuration</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Hidden file input for import */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleImportJSON}
            className="hidden"
          />
        </div>
      </form>
    </div>
  );
}
