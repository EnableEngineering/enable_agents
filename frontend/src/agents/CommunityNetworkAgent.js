import React, { useState, useRef, useEffect } from 'react';
import Header from '../core/Header';
import { BackButton, Input, Textarea, ConfirmDialog, ProjectSelector, LiveModeHint, AgentOutcomesStrip, ProjectGate, NetworkSearchResults } from '../components';
import '../styles/CommunityNetworkAgent.css';
import { STRINGS } from '../constants/strings';
import { API_CONFIG } from '../config/apiConfig';
import { useAgentChat } from '../hooks/useAgentChat';
import { authJsonHeaders, authOptionalHeaders } from '../core/authHeaders';
import MessageContent from '../components/MessageContent';
import { formatDate, formatTime, getRelativeDateLabel, isSameDay } from '../utils/dateFormat';
import { useSelectedProjectId } from '../hooks/useSelectedProjectId';

// message.data.type values with their own rich renderer in the chat below -
// any other type (e.g. csv_upload_success) still renders as a normal text
// message, just with extra metadata attached.
const RICH_MESSAGE_TYPES = ['search_results', 'user_favorites', 'profile_detail', 'cv_analysis'];

function CommunityNetworkAgent() {
  const selectedProjectId = useSelectedProjectId();
  const {
    messages, inputMessage, setInputMessage,
    isLoading, setIsLoading, messagesEndRef,
    addMessage, clearChat, continueChat, showClearConfirm,
    checkExistingFile, saveJSONToFile,
  } = useAgentChat(
    "Welcome to the Community Network Agent! Now I can help you enhance your network!",
    'dataset',
    'community_network'
  );

  const [csvData, setCsvData] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const csvFileRef = useRef(null);
  const cvFileRef = useRef(null);
  const [existingFiles, setExistingFiles] = useState(new Map());
  // Use user email as ID, with project scoping
  const currentUserId = localStorage.getItem('userEmail') || 'anonymous';
  const [userFavorites, setUserFavorites] = useState([]);

  // Clear cached data when the project changes
  useEffect(() => {
    if (!selectedProjectId) {
      setCsvData(null);
      setUserProfile(null);
    }
  }, [selectedProjectId]);

  // Function to save JSON data to file
  // Enhanced handleSearch function with better user feedback
  const handleSearch = async (query) => {
    try {
      addMessage("Searching through the data...", 'agent', null, 'markdown');

      const response = await fetch(`${API_CONFIG.API_URL}/simple_search`, {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({
          query: query,
          data: csvData
        })
      });

      const result = await response.json();

      if (result.success) {
        if (result.total_found > 0) {
          // Show what keywords were extracted
          const keywordsText = Object.entries(result.keywords)
            .filter(([key, values]) => values && values.length > 0)
            .map(([key, values]) => `${key}: ${values.join(', ')}`)
            .join(' | ');

          addMessage(
            `**Search Results** (${result.total_found} found)\n\n**Keywords extracted:** ${keywordsText}`,
            'agent',
            {
              type: 'search_results',
              data: {
                query,
                results: result.results,
                total_found: result.total_found,
                keywords: result.keywords,
              },
            },
            'markdown'
          );
          
          // Show more results option if there are many
          if (result.total_found > 5) {
            addMessage(`**Found ${result.total_found} total results.** Showing top 5. Try being more specific to narrow down results.`, 'agent', null, 'markdown');
          }
          
          // Suggest related searches if results are limited
          if (result.total_found < 3 && result.total_found > 0) {
            // addMessage("💡 **Want more results?** Try:\n• Using broader terms\n• Searching by different fields\n• Checking spelling of keywords", 'agent', null, 'markdown');
          }
        } else {
          // No results found - provide helpful suggestions
          const keywordsText = Object.entries(result.keywords)
            .filter(([key, values]) => values && values.length > 0)
            .map(([key, values]) => `${key}: ${values.join(', ')}`)
            .join(' | ');
          
          addMessage(`**No results found** for: "${query}"\n\n**Keywords I looked for:** ${keywordsText}\n\n**Try:**\n• Different spelling or synonyms\n• Broader search terms\n• Different fields (company vs title vs skills)\n\n**Example searches:**\n• "Find engineers" (instead of "senior software engineers")\n• "People at tech companies"\n• "Alumni with programming skills"`, 'agent', null, 'markdown');
        }
      } else {
        addMessage(`**Search needs more specific input:** ${result.error}\n\nPlease try rephrasing your request e.g., mention company name or job title`, 'agent', null, 'markdown');
      }
    } catch (error) {
      console.error('Search error:', error);
      addMessage("**Connection error.** Please check your connection and try again.", 'agent', null, 'markdown');
    }
  };

  // Updated CSV Upload Handler with file checking and JSON saving
  const handleCSVUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const allowedTypes = ['.csv', '.xlsx', '.xls'];
    const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
    
    if (!allowedTypes.includes(fileExtension)) {
      addMessage("Please upload a valid CSV or XLSX file.", 'agent', null, 'markdown');
      return;
    }

    setIsLoading(true);

    try {
      // Step 1: Check if file already exists and compare sizes
      const fileCheckResult = await checkExistingFile(file.name, file.size);
      
      if (fileCheckResult.should_skip) {
        // Load existing JSON data
        const jsonFileName = file.name.replace(/\.(csv|xlsx|xls)$/i, '.json');
        const loadResponse = await fetch(`${API_CONFIG.API_URL}/load_json_file`, {
          method: 'POST',
          headers: authJsonHeaders(),
          body: JSON.stringify({
            file_name: jsonFileName,
            folder_name: 'dataset'
          })
        });

        const loadResult = await loadResponse.json();
        
        if (loadResult.success) {
          setCsvData(loadResult.data);

          // Update existing files tracking
          setExistingFiles(prev => new Map(prev.set(file.name, {
            size: file.size,
            processed: true,
            json_file: jsonFileName,
            profiles_count: loadResult.data.length
          })));

          addMessage(`Loaded ${loadResult.data.length} profiles from "${file.name}" (already processed previously).`, 'agent', {
            type: 'csv_upload_success',
            data: {
              profiles_count: loadResult.data.length,
              columns: Object.keys(loadResult.data[0] || {}),
              file_type: fileExtension.substring(1).toUpperCase(),
              json_saved: true,
              json_file: jsonFileName,
            }
          }, 'markdown');

          setIsLoading(false);
          event.target.value = '';
          return;
        }
      }

      // Step 2: File is new or has more data, proceed with conversion
      if (fileCheckResult.exists && !fileCheckResult.should_skip) {
        addMessage(`File exists but new version has more data (${file.size} vs ${fileCheckResult.existing_size} bytes). Updating...`, 'agent', null, 'markdown');
      } else {
        // addMessage("New file detected. Converting to JSON format...", 'agent', null, 'markdown');
      }

      // Step 3: Upload and convert file to JSON
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder_name', 'dataset');
      formData.append('multiple_sheets', 'false');

      const response = await fetch(`${API_CONFIG.API_URL}/file_to_json_convert`, {
        method: 'POST',
        headers: authOptionalHeaders(),
        body: formData
      });

      const conversionResult = await response.json();

      if (conversionResult.success) {
        const profiles = conversionResult.data;
        setCsvData(profiles);
        
        // Step 4: Save JSON file for future use
        // addMessage("Saving JSON file for faster future access...", 'agent', null, 'markdown');
        const saveResult = await saveJSONToFile(profiles, file.name);
        
        if (saveResult.success) {
          addMessage(`File processed and saved! Found ${profiles.length} profiles.`, 'agent', {
            type: 'csv_upload_success',
            data: { 
              profiles_count: profiles.length,
              columns: Object.keys(profiles[0] || {}),
              file_type: fileExtension.substring(1).toUpperCase(),
              json_saved: true,
              json_file: saveResult.file_path
            }
          }, 'markdown');

          // Update existing files tracking
          setExistingFiles(prev => new Map(prev.set(file.name, {
            size: file.size,
            processed: true,
            json_file: saveResult.file_name,
            profiles_count: profiles.length
          })));

        } else {
          addMessage(`File converted successfully! Found ${profiles.length} profiles. (JSON save failed: ${saveResult.error})`, 'agent', {
            type: 'csv_upload_success',
            data: { 
              profiles_count: profiles.length,
              columns: Object.keys(profiles[0] || {}),
              file_type: fileExtension.substring(1).toUpperCase(),
              json_saved: false
            }
          }, 'markdown');
        }

        // Show a preview of the data structure
        const sampleProfile = profiles[0];
        if (sampleProfile) {
          const availableFields = Object.keys(sampleProfile);
          // addMessage(`**Data Structure Preview:**\nAvailable fields: ${availableFields.join(', ')}\n\nYou can now search through this data!`, 'agent', null, 'markdown');
        }
        
      } else {
        addMessage(`Error converting file: ${conversionResult.error}`, 'agent', null, 'markdown');
      }
    } catch (error) {
      console.error('File processing error:', error);
      addMessage("Error processing file. Please try again.", 'agent', null, 'markdown');
    } finally {
      setIsLoading(false);
      event.target.value = '';
    }
  };

  // Add this simple matchmaking function
  const getCompanyRecommendations = async (skills, industry, csvData) => {
    try {
      // Extract unique companies from the data
      const companies = [...new Set(csvData.map(record => 
        record.company || record.Company || record.organization || record.Organization
      ).filter(Boolean))];

      const prompt = `Based on these skills: ${skills.join(', ')} and industry: ${industry}, suggest 8-10 companies from this list that would be most relevant: ${companies.join(', ')}. 

  Return only company names separated by commas.`;

      const response = await fetch(`${API_CONFIG.API_URL}/search_suggestions`, {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({
          prompt: prompt,
          max_tokens: 200,
          temperature: 0.3
        })
      });

      const result = await response.json();
      
      if (result.success) {
        // Parse company names from response
        const recommendedCompanies = result.response
          .split(',')
          .map(company => company.trim())
          .filter(company => company.length > 0);
        
        return recommendedCompanies;
      }
      return [];
    } catch (error) {
      console.error('Matchmaking error:', error);
      return [];
    }
  };

  // Update the handleCVUpload function - add matchmaking after profile creation:
  const handleCVUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.name.endsWith('.pdf')) {
      addMessage("Please upload a PDF document.", 'agent', null, 'markdown');
      return;
    }

    setIsAnalyzing(true);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder_name', 'cv_analysis');

      const uploadResponse = await fetch(`${API_CONFIG.API_URL}/upload`, {
        method: 'POST',
        headers: authOptionalHeaders(),
        body: formData
      });

      const uploadResult = await uploadResponse.json();

      if (uploadResponse.ok) {
        const skillsPrompt = `
          Analyze this CV and extract:
          1. Technical skills (list 8-12 key skills)
          2. Career goals (list 3-5 goals)
          3. Industry focus
          4. Experience level
          
          Format the response as:
          Skills: skill1, skill2, skill3...
          Goals: goal1, goal2, goal3...
          Industry: industry name
          Level: experience level
        `;

        const ragResponse = await fetch(`${API_CONFIG.API_URL}/rag_test`, {
          method: 'POST',
          headers: authJsonHeaders(),
          body: JSON.stringify({
            query: skillsPrompt,
            file_name: file.name,
            data_store: 'cv_analysis'
          })
        });

        const ragResult = await ragResponse.json();

        if (ragResponse.ok) {
          const profile = parseSkillsFromResponse(ragResult.answer);
          setUserProfile(profile);

          const skillsText = profile.skills.join(', ');
          const goalsText = profile.career_goals.join(', ');
          
          addMessage(`**We analyzed your CV!**\n\n**Skills:** ${skillsText}\n\n**Goals:** ${goalsText}\n\n**Industry:** ${profile.industry}`, 'agent', {
            type: 'cv_analysis',
            data: profile
          }, 'markdown');

          // ADD MATCHMAKING HERE - only if csvData is available
          if (csvData && csvData.length > 0) {
            const recommendedCompanies = await getCompanyRecommendations(
              profile.skills, 
              profile.industry, 
              csvData
            );

            if (recommendedCompanies.length > 0) {
              addMessage(`**Recommended Companies:** ${recommendedCompanies.join(', ')}\n\n**Try searching:** "Find people at ${recommendedCompanies[0]}" or "Show engineers at ${recommendedCompanies[1]}"`, 'agent', null, 'markdown');
            }
          }

        } else {
          addMessage(`Error analyzing CV: ${ragResult.error || 'Unknown error'}`, 'agent', null, 'markdown');
        }
      } else {
        addMessage(`Error uploading CV: ${uploadResult.error}`, 'agent', null, 'markdown');
      }
    } catch (error) {
      console.error('CV Analysis Error:', error);
      addMessage("Error analyzing CV. Please try again.", 'agent', null, 'markdown');
    } finally {
      setIsAnalyzing(false);
      event.target.value = '';
    }
  };

  // CV Skills parsing function
  const parseSkillsFromResponse = (response) => {
    const lines = response.split('\n');
    let skills = [];
    let goals = [];
    let industry = '';
    let level = '';

    lines.forEach(line => {
      const lowerLine = line.toLowerCase();
      if (lowerLine.includes('skills:')) {
        const skillsText = line.split(':')[1] || '';
        skills = skillsText.split(',').map(s => s.trim()).filter(s => s);
      } else if (lowerLine.includes('goals:')) {
        const goalsText = line.split(':')[1] || '';
        goals = goalsText.split(',').map(g => g.trim()).filter(g => g);
      } else if (lowerLine.includes('industry:')) {
        industry = line.split(':')[1]?.trim() || '';
      } else if (lowerLine.includes('level:')) {
        level = line.split(':')[1]?.trim() || '';
      }
    });

    if (skills.length === 0) {
      const words = response.toLowerCase();
      const techSkills = ['python', 'javascript', 'react', 'node.js', 'sql', 'aws', 'docker', 'git', 'java', 'html', 'css', 'machine learning', 'data analysis', 'project management', 'leadership'];
      skills = techSkills.filter(skill => words.includes(skill)).map(skill => 
        skill.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
      );
    }

    if (goals.length === 0) {
      goals = ['Career Growth', 'Leadership Role', 'Technical Excellence'];
    }

    if (!industry) {
      industry = 'Technology';
    }

    if (!level) {
      level = 'Mid-level';
    }

    return {
      skills: skills.slice(0, 12),
      career_goals: goals.slice(0, 5),
      industry,
      experience_level: level
    };
  };

  // Enhanced message handler focused on data search and retrieval
  const handleSendMessage = async (e = null) => {
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }
    
    if (!inputMessage.trim()) return;

    const userMessage = inputMessage.trim();
    const userMessageLower = userMessage.toLowerCase();
    
    // Add user message to chat
    addMessage(userMessage, 'user', null, 'markdown');
    setInputMessage('');
    setIsLoading(true);

    // Add favorites check here
    if (userMessageLower.includes('favorites') || userMessageLower.includes('saved') || userMessageLower.includes('show favorites')) {
      showUserFavorites();
      setIsLoading(false);
      return;
    }

    // Check if data is available
    if (!csvData || csvData.length === 0) {
      setTimeout(() => {
        addMessage("Please upload a CSV/Excel file first so I can help you search through the data!\n\n**Once you upload data, you can search like:**\n- Find people at Google\n- Show me software engineers\n- People with Python skills\n- Alumni in San Francisco", 'agent', null, 'markdown');
        setIsLoading(false);
      }, 500);
      return;
    }

    // Detect search queries
    const searchKeywords = [
      'find', 'search', 'show', 'get', 'who', 'people', 'alumni', 'working', 'at', 'with',
      'developers', 'engineers', 'managers', 'analysts', 'designers', 'company', 'companies',
      'skills', 'skill', 'technology', 'experience', 'location', 'city', 'country', 'in'
    ];
    
    const isSearchQuery = searchKeywords.some(keyword => 
      userMessageLower.includes(keyword)
    );

    // Handle search queries
    if (isSearchQuery) {
      try {
        await handleSearch(userMessage);
      } catch (error) {
        console.error('Search error:', error);
        addMessage("Error performing search. Please try again.", 'agent', null, 'markdown');
      }
      setIsLoading(false);
      return;
    }

    // Handle general data questions and provide guidance
    setTimeout(() => {
      if (userMessageLower.includes('help') || userMessageLower.includes('what can you do')) {
        addMessage(`**I can help you search through your data!**\n\n**Search Examples:**\n- Find people at Microsoft\n- Show marketing managers\n- People with React skills\n- Alumni in New York\n- Senior engineers at tech companies\n- Developers with Python and JavaScript\n\n**Data Available:** ${csvData.length} profiles\n**Fields:** ${Object.keys(csvData[0] || {}).join(', ')}\n\nJust ask me naturally!`, 'agent', null, 'markdown');
      } else if (userMessageLower.includes('data') || userMessageLower.includes('profiles') || userMessageLower.includes('how many')) {
        // Show data summary
        const sampleProfile = csvData[0];
        const availableFields = Object.keys(sampleProfile);
        addMessage(`**Data Summary:**\n\n**Total Profiles:** ${csvData.length}\n**Available Fields:** ${availableFields.join(', ')}\n\n**Sample Profile:**\n${formatSampleProfile(sampleProfile)}\n\n**Try searching:** "Find people at [company]" or "Show [job title]"`, 'agent', null, 'markdown');
      } else {
        // Default response - guide user to search
        addMessage(`I have ${csvData.length} profiles loaded and ready to search!\n\n**Try searching like:**\n- Find software engineers\n- People working at Google\n- Show me data scientists\n- Alumni with machine learning skills\n\n**Available fields:** ${Object.keys(csvData[0] || {}).join(', ')}\n\nWhat would you like to find?`, 'agent', null, 'markdown');
      }
      setIsLoading(false);
    }, 1000);
  };

  // Helper function to format sample profile
  const formatSampleProfile = (profile) => {
    const name = profile.name || profile.Name || profile.full_name || 'Unknown';
    const company = profile.company || profile.Company || profile.organization || 'Unknown';
    const title = profile.title || profile.Title || profile.position || 'Unknown';
    
    return `**Name:** ${name}\n**Company:** ${company}\n**Title:** ${title}`;
  };

  // Function to save profile to favorites
  const saveToFavorites = async (profileData) => {
    try {
      const response = await fetch(`${API_CONFIG.API_URL}/save_user_favorite`, {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({
          user_id: currentUserId,
          project_id: selectedProjectId,
          profile_data: profileData
        })
      });

      const result = await response.json();
      
      if (result.success) {
        addMessage(`**Profile saved to favorites!**\n\n**${profileData.full_name || profileData.name}** from **${profileData.company}** added to your favorites.\n\n**Total favorites:** ${result.favorites_count}`, 'agent', null, 'markdown');
        // Refresh favorites list
        loadUserFavorites();
      } else {
        addMessage(`**Error saving to favorites:** ${result.error}`, 'agent', null, 'markdown');
      }
    } catch (error) {
      console.error('Error saving to favorites:', error);
      addMessage("**Error saving to favorites.** Please try again.", 'agent', null, 'markdown');
    }
  };

  // Function to load user favorites
  const loadUserFavorites = async () => {
    try {
      const response = await fetch(`${API_CONFIG.API_URL}/get_user_favorites`, {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({
          user_id: currentUserId,
          project_id: selectedProjectId
        })
      });

      const result = await response.json();
      
      if (result.success) {
        setUserFavorites(result.favorites);
      }
    } catch (error) {
      console.error('Error loading favorites:', error);
    }
  };

  useEffect(() => {
    loadUserFavorites();
  }, [currentUserId]);

  const handleGenerateOutreach = (profile) => {
    addMessage(
      `**Outreach draft for ${profile.full_name}**\n\nHi ${profile.full_name.split(' ')[0]},\n\nI noticed your work as ${profile.title} at ${profile.company}. I'd love to connect and explore whether there's mutual value in collaborating.\n\nWould you be open to a brief call next week?`,
      'agent',
      null,
      'markdown'
    );
  };

  const showUserFavorites = () => {
    if (userFavorites.length === 0) {
      addMessage('**No favorites saved yet.**\n\nSave profiles using the save icon on search result cards.', 'agent', null, 'markdown');
      return;
    }

    addMessage(`**Your Favorites** (${userFavorites.length} saved)`, 'agent', {
      type: 'user_favorites',
      data: { favorites: userFavorites, count: userFavorites.length },
    }, 'markdown');
  };

  // Fix 3: Add the missing handleKeyPress function
  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Fix 4: Add the missing removeFromFavorites function
  const removeFromFavorites = async (favoriteId) => {
    try {
      const response = await fetch(`${API_CONFIG.API_URL}/remove_user_favorite`, {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({
          user_id: currentUserId,
          project_id: selectedProjectId,
          favorite_id: favoriteId
        })
      });

      const result = await response.json();
      
      if (result.success) {
        addMessage(`**Profile removed from favorites.**\n\n**Total favorites:** ${result.favorites_count}`, 'agent', null, 'markdown');
        // Refresh favorites list
        loadUserFavorites();
      } else {
        addMessage(`**Error removing from favorites:** ${result.error}`, 'agent', null, 'markdown');
      }
    } catch (error) {
      console.error('Error removing from favorites:', error);
      addMessage("**Error removing from favorites.** Please try again.", 'agent', null, 'markdown');
    }
  };

  return (
    <div className="community-network-agent">
      <Header />

      <div className="agent-page-header">
        <div className="agent-header-left">
          <BackButton />
          <div className="agent-header-content">
            <div className="agent-title-row">
              <h1>Community Network</h1>
            </div>
            <p className="text-muted">
              Discover connections, find warm intros, and grow your professional network.
            </p>
          </div>
        </div>
        <div className="agent-header-right">
          <ProjectSelector
            agentKey="communityNetwork"
            onProjectChange={(project) => {
              if (project) {
                console.log('Project selected:', project.name);
              }
            }}
          />
        </div>
      </div>

      <AgentOutcomesStrip
        items={[
          { iconSrc: '/assets/icons/search-analysis.png', title: 'Search your network', description: 'Find people by role, company, or skills.' },
          { iconSrc: '/assets/icons/networking.png', title: 'Warm intros', description: 'Identify the best connections for your goals.' },
          { iconSrc: '/assets/icons/saved.png', title: 'Save favorites', description: 'Bookmark profiles for follow-up.' },
        ]}
      />

      <LiveModeHint
        requireProject
        message="Choose a project from the header dropdown, or create one with + New Project. Switch to Demo for a sample network dataset."
      />

      <ProjectGate agentLabel="Community Network workspace">
      <div className="main-container">
        {/* Left Section - File Uploads */}
        <div className="upload-section">
          <h3>Connect Network Data</h3>
          
          {/* CSV Upload */}
          <div className="upload-card">
            <div className="upload-header">
              <h4>Network Data</h4>
              <span className="status-badge">
                {csvData ? `${csvData.length} loaded` : 'No data'}
              </span>
            </div>
            <p>Upload network data or ask the Admin for access. Write at <strong>engineering@enableyou.co</strong> for data access</p>
            <button
              onClick={() => csvFileRef.current?.click()} 
              className="upload-btn csv-btn"
              disabled={isLoading}
            >
              {isLoading ? STRINGS.COMMON.PROCESSING : 'Connect Dataset'}
            </button>
            <input
              type="file"
              ref={csvFileRef}
              onChange={handleCSVUpload}
              accept=".csv,.xlsx,.xls"
              style={{ display: 'none' }}
            />
          </div>

          {/* Data Preview - Compact List */}
          {csvData && csvData.length > 0 && (
            <div className="data-preview">
              <div className="data-preview-header">
                <h4>Network</h4>
                <span className="preview-count">{csvData.length}</span>
              </div>

              <ul className="profile-list-compact">
                {csvData.slice(0, 5).map((row, rowIndex) => {
                  const name = row.name || row.Name || row.full_name || `Profile ${rowIndex + 1}`;
                  const company = row.company || row.Company || row.organization || '';
                  const role = row.role || row.title || row.Title || row['Job title'] || '';
                  const location = row.location || row.Location || row.city || '';
                  const email = row.email || row.Email || '';
                  const skills = row.skills || [];

                  const handleProfileClick = () => {
                    addMessage('', 'agent', {
                      type: 'profile_detail',
                      data: { name, role, company, location, email, skills: Array.isArray(skills) ? skills : [] }
                    }, 'markdown');
                  };

                  return (
                    <li key={rowIndex} className="profile-list-item" onClick={handleProfileClick}>
                      <span className="profile-list-avatar">{name.charAt(0)}</span>
                      <span className="profile-list-name">{name}</span>
                      {role && <span className="profile-list-role">{role}</span>}
                    </li>
                  );
                })}
              </ul>

              {csvData.length > 5 && (
                <p className="preview-hint">+{csvData.length - 5} more. Use chat to search.</p>
              )}
            </div>
          )}

          {/* CV Upload */}
          <div className="upload-card">
            <div className="upload-header">
              <h4>Your Profile Analysis</h4>
              <span className="status-indicator">
                {userProfile ? 'Profile analyzed' : 'No Profile'}
              </span>
            </div>
            <p>Upload your Profile to help us understand your skills, goals, and experience level.</p>
            <button 
              onClick={() => cvFileRef.current?.click()} 
              className="upload-btn cv-btn"
              disabled={isAnalyzing}
            >
              {isAnalyzing ? STRINGS.COMMON.ANALYZING : 'Upload Your Profile'}
            </button>
            <input
              type="file"
              ref={cvFileRef}
              onChange={handleCVUpload}
              accept=".pdf,.doc,.docx"
              style={{ display: 'none' }}
            />
          </div>

          {/* Profile Summary */}
          {userProfile && (
            <div className="profile-summary">
              <h4>Your Profile</h4>
              <div className="profile-item">
                <strong>Industry:</strong> {userProfile.industry}
              </div>
              <div className="profile-item">
                <strong>Experience:</strong> {userProfile.experience_level}
              </div>
              <div className="profile-item">
                <strong>Key Skills:</strong>
                <div className="skills-container">
                  {userProfile.skills.slice(0, 6).map((skill, index) => (
                    <span key={index} className="skill-tag">{skill}</span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Section - Chat Interface */}
        <div className="chat-section">
          <div className="chat-header">
            <h3> Professional Network Agent</h3>
            <div className="chat-status">
              <span className={`status-dot ${csvData && userProfile ? 'status-dot--ready' : csvData ? 'status-dot--warn' : 'status-dot--error'}`}>
                {csvData && userProfile ? 'Connected to data source' :
                 csvData ? 'Upload CV to continue' : 'Upload data to start'}
              </span>
            </div>
          </div>

          <div className="messages-container">
            {messages.map((message, index) => {
              const prevMessage = messages[index - 1];
              const showDateSeparator = !prevMessage || !isSameDay(message.timestamp, prevMessage.timestamp);
              return (
                <React.Fragment key={message.id}>
                  {showDateSeparator && (
                    <div className="date-separator">
                      <span>{getRelativeDateLabel(message.timestamp)}</span>
                    </div>
                  )}
                  <div className={`message ${message.sender}`}>
                    <div className={`message-content ${message.data?.type === 'profile_detail' ? 'has-card' : ''}`}>
                      {/* Only search_results/user_favorites/profile_detail/cv_analysis have their
                          own rich renderer below - any other data.type (e.g. csv_upload_success,
                          which just carries metadata alongside a normal text message) should still
                          render its text, not disappear silently. */}
                      {message.text && !RICH_MESSAGE_TYPES.includes(message.data?.type) && <MessageContent message={message} />}

                      {/* CV Analysis visualization */}
                      {message.data && message.data.type === 'search_results' && (
                        <NetworkSearchResults
                          results={message.data.data?.results || []}
                          onSave={(profile) => saveToFavorites({ ...profile.raw, full_name: profile.full_name, company: profile.company, title: profile.title })}
                          onMessage={handleGenerateOutreach}
                        />
                      )}

                      {message.data && message.data.type === 'user_favorites' && (
                        <div className="network-favorites-list">
                          {(message.data.data?.favorites || []).map((favorite) => {
                            const full_name = favorite.full_name || `${favorite.name || ''} ${favorite.lastname || ''}`.trim();
                            return (
                              <div key={favorite.favorite_id} className="network-favorite-item">
                                <strong>{full_name}</strong>
                                <div className="network-favorite-meta">{favorite.company || favorite.Company} · {favorite.title || favorite['Job title'] || favorite.Title}</div>
                                {favorite.saved_at && <div className="network-favorite-meta">Saved {formatDate(favorite.saved_at)}</div>}
                                <button type="button" className="network-favorite-remove" onClick={() => removeFromFavorites(favorite.favorite_id)}>Remove</button>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {message.data && message.data.type === 'profile_detail' && (
                        <div className="profile-detail-card">
                          <div className="profile-detail-header">
                            <span className="profile-detail-avatar">{message.data.data.name?.charAt(0) || '?'}</span>
                            <div className="profile-detail-title">
                              <h4>{message.data.data.name}</h4>
                              <p>{message.data.data.role}{message.data.data.company && ` at ${message.data.data.company}`}</p>
                            </div>
                          </div>
                          <div className="profile-detail-body">
                            {message.data.data.location && (
                              <div className="profile-detail-row">
                                <span className="profile-detail-label">Location:</span>
                                <span>{message.data.data.location}</span>
                              </div>
                            )}
                            {message.data.data.email && (
                              <div className="profile-detail-row">
                                <span className="profile-detail-label">Email:</span>
                                <a href={`mailto:${message.data.data.email}`}>{message.data.data.email}</a>
                              </div>
                            )}
                            {message.data.data.skills?.length > 0 && (
                              <div className="profile-detail-skills">
                                {message.data.data.skills.map((skill, idx) => (
                                  <span key={idx} className="skill-tag">{skill}</span>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="profile-detail-footer">
                            <div className="profile-detail-actions">
                              <button type="button" className="btn-text" onClick={() => handleGenerateOutreach(message.data.data)}>Draft Message</button>
                              <button type="button" className="btn-text" onClick={() => saveToFavorites(message.data.data)}>Save</button>
                            </div>
                            <span className="profile-detail-time">{formatTime(message.timestamp)}</span>
                          </div>
                        </div>
                      )}

                      {message.data && message.data.type === 'cv_analysis' && (
                        <div className="profile-viz">
                          <h4>Extracted Skills</h4>
                          <div className="skills-tags">
                            {message.data.data.skills.map((skill, idx) => (
                              <span key={idx} className="skill-tag">{skill}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Time for text-only messages */}
                      {!RICH_MESSAGE_TYPES.includes(message.data?.type) && <span className="message-time">{formatTime(message.timestamp)}</span>}
                    </div>
                  </div>
                </React.Fragment>
              );
            })}
            
            {(isLoading || isAnalyzing) && (
              <div className="message agent">
                <div className="message-content">
                  <div className="typing-indicator">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                  <p className="loading-text">
                    {isAnalyzing ? 'Analyzing CV...' : 'Processing...'}
                  </p>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="input-container">
            <textarea
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="You can ask the Network agent to find relevant people in your network, after you connect network data and analyse your CV"
              className="message-input"
              rows="1"
            />
            <button 
              onClick={handleSendMessage} 
              className="send-button"
              disabled={isLoading || isAnalyzing}
            >
              Send
            </button>
          </div>
        </div>
      </div>
      </ProjectGate>

      {/* Chat History Confirmation Dialog */}
      <ConfirmDialog
        open={showClearConfirm}
        title="Continue Previous Chat?"
        message="You have a previous conversation. Would you like to continue where you left off or start fresh?"
        confirmLabel="Continue"
        cancelLabel="Start Fresh"
        onConfirm={continueChat}
        onCancel={clearChat}
        variant="info"
      />
    </div>
  );
}

export default CommunityNetworkAgent;