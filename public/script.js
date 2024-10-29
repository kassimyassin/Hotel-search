// public/script.js
let citySearchTimeout;
let currentSearchResults = {
    hotels: [],
    page: 1,
    totalPages: 1,
    totalResults: 0
};

// Initialize elements
document.addEventListener('DOMContentLoaded', () => {
    initializeAutocomplete();
    initializeRadiusSlider();
    setDefaultDates();
});

// Radius slider initialization
function initializeRadiusSlider() {
    const radiusSlider = document.getElementById('radius');
    const radiusValue = document.getElementById('radiusValue');
    
    radiusSlider.addEventListener('input', (e) => {
        radiusValue.textContent = `${e.target.value} km`;
    });
}

// Set default dates
function setDefaultDates() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dayAfter = new Date();
    dayAfter.setDate(dayAfter.getDate() + 2);

    const formatDate = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    document.getElementById('checkIn').value = formatDate(tomorrow);
    document.getElementById('checkOut').value = formatDate(dayAfter);
}

// Location search and autocomplete
async function searchLocations(query) {
    try {
        const response = await fetch(`/api/v1/locations/search?keyword=${encodeURIComponent(query)}`);
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Location search error:', error);
        return [];
    }
}

function initializeAutocomplete() {
    const locationInput = document.getElementById('locationInput');
    const suggestionsList = document.createElement('ul');
    suggestionsList.className = 'suggestions-list';
    locationInput.parentNode.appendChild(suggestionsList);

    locationInput.addEventListener('input', async (e) => {
        const query = e.target.value;
        
        if (query.length < 2) {
            suggestionsList.innerHTML = '';
            return;
        }

        if (citySearchTimeout) {
            clearTimeout(citySearchTimeout);
        }

        citySearchTimeout = setTimeout(async () => {
            const locations = await searchLocations(query);
            suggestionsList.innerHTML = locations.map(location => {
                const displayText = location.name + (location.country ? `, ${location.country}` : '');
                return `
                    <li data-location='${JSON.stringify(location)}' class="location-item">
                        <div class="location-main">${displayText}</div>
                        ${location.districts ? `
                            <div class="districts-list">
                                ${location.districts.map(district => `
                                    <span class="district-option" 
                                          data-district='${JSON.stringify(district)}'>
                                        ${district.name}
                                    </span>
                                `).join('')}
                            </div>
                        ` : ''}
                    </li>
                `;
            }).join('');
        }, 300);
    });

    suggestionsList.addEventListener('click', (e) => {
        const li = e.target.closest('.location-item');
        const districtOption = e.target.closest('.district-option');
        
        if (li) {
            let locationData = JSON.parse(li.dataset.location);
            
            if (districtOption) {
                const districtData = JSON.parse(districtOption.dataset.district);
                locationData = {
                    ...locationData,
                    name: `${districtData.name}, ${locationData.name}`,
                    geoCode: {
                        latitude: districtData.latitude,
                        longitude: districtData.longitude
                    }
                };
                locationInput.value = locationData.name;
            } else {
                locationInput.value = `${locationData.name}${locationData.country ? `, ${locationData.country}` : ''}`;
            }
            
            locationInput.dataset.location = JSON.stringify(locationData);
            suggestionsList.innerHTML = '';
        }
    });

    document.addEventListener('click', (e) => {
        if (!locationInput.contains(e.target)) {
            suggestionsList.innerHTML = '';
        }
    });
}

// Hotel search functionality
async function searchHotels(page = 1) {
    const results = document.getElementById('results');
    results.innerHTML = '<div class="searching">Searching for hotels... Please wait.</div>';

    try {
        const locationInput = document.getElementById('locationInput');
        const locationData = JSON.parse(locationInput.dataset.location || '{}');

        if (!locationData.name || !locationInput.value) {
            results.innerHTML = `
                <div class="error">
                    <h3>Please select a location from the suggestions</h3>
                    <p>Start typing a city name and select from the dropdown list.</p>
                </div>`;
            return;
        }

        // Get selected ratings
        const selectedRatings = Array.from(document.querySelectorAll('#ratingFilters input:checked'))
            .map(input => input.value);

        // Get price range
        const priceRangeSelect = document.getElementById('priceRange');
        let priceRange = null;
        if (priceRangeSelect.value) {
            switch (priceRangeSelect.value) {
                case 'budget':
                    priceRange = { min: 0, max: 100 };
                    break;
                case 'moderate':
                    priceRange = { min: 100, max: 200 };
                    break;
                case 'luxury':
                    priceRange = { min: 200, max: 10000 };
                    break;
            }
        }

        const searchParams = {
            location: locationData,
            checkIn: document.getElementById('checkIn').value,
            checkOut: document.getElementById('checkOut').value,
            adults: parseInt(document.getElementById('adults').value),
            radius: parseInt(document.getElementById('radius').value),
            page: page,
            ratings: selectedRatings.length > 0 ? selectedRatings : undefined,
            priceRange: priceRange,
            sortBy: document.getElementById('sortBy').value
        };

        console.log('Searching with params:', searchParams);

        const response = await fetch('/api/v1/hotels/search', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(searchParams)
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to fetch hotels');
        }

        // Update global state
        currentSearchResults = {
            hotels: data.data,
            page: page,
            totalPages: data.pagination.totalPages,
            totalResults: data.pagination.totalResults
        };

        updateSearchControls();
        renderHotels(data.data);
        updatePagination();

    } catch (error) {
        console.error('Search error:', error);
        results.innerHTML = `
            <div class="error">
                <h3>Error searching for hotels</h3>
                <p>${error.message}</p>
                <p>Please try again or contact support if the problem persists.</p>
            </div>`;
    }
}

function renderHotels(hotels) {
    const results = document.getElementById('results');
    
    if (!hotels.length) {
        results.innerHTML = `
            <div class="no-results">
                <p>No hotels found for your search criteria.</p>
                <p>Try:</p>
                <ul>
                    <li>Different dates</li>
                    <li>Different location or district</li>
                    <li>Increasing the search radius</li>
                    <li>Adjusting your filters</li>
                </ul>
            </div>`;
        return;
    }

    results.innerHTML = hotels.map(hotel => `
        <div class="hotel-card">
            <div class="hotel-header">
                <h3>${hotel.hotel.name || 'Hotel Name Not Available'}</h3>
                ${hotel.hotel.rating ? 
                    `<div class="hotel-rating">${'⭐'.repeat(parseInt(hotel.hotel.rating))}</div>` 
                    : ''}
            </div>
            
            <div class="hotel-details">
                <p class="address">${formatAddress(hotel)}</p>
                
                <div class="price-info">
                    <div class="price">
                        <strong>Price:</strong> ${formatPrice(hotel.offers)}
                    </div>
                    ${hotel.offers?.[0]?.room?.typeEstimated?.category ? `
                        <div class="room-type">
                            ${hotel.offers[0].room.typeEstimated.category}
                        </div>
                    ` : ''}
                </div>

                ${hotel.offers?.[0]?.policies?.cancellation?.description ? `
                    <div class="cancellation-policy">
                        ${hotel.offers[0].policies.cancellation.description}
                    </div>
                ` : ''}
            </div>

            <div class="hotel-actions">
                <a href="https://www.google.com/maps?q=${encodeURIComponent(hotel.hotel.name + ' ' + formatAddress(hotel))}" 
                   target="_blank" rel="noopener noreferrer" class="map-link">
                    View on Map
                </a>
            </div>
        </div>
    `).join('');
}

function updateSearchControls() {
    const searchControls = document.getElementById('searchControls');
    const resultCount = document.getElementById('resultCount');
    
    searchControls.style.display = 'flex';
    resultCount.textContent = `Found ${currentSearchResults.totalResults} hotels`;
}

function updatePagination() {
    const pagination = document.getElementById('pagination');
    const pageInfo = document.getElementById('pageInfo');
    const prevButton = document.getElementById('prevPage');
    const nextButton = document.getElementById('nextPage');

    if (currentSearchResults.totalPages > 1) {
        pagination.style.display = 'flex';
        pageInfo.textContent = `Page ${currentSearchResults.page} of ${currentSearchResults.totalPages}`;
        prevButton.disabled = currentSearchResults.page === 1;
        nextButton.disabled = currentSearchResults.page === currentSearchResults.totalPages;
    } else {
        pagination.style.display = 'none';
    }
}

function changePage(delta) {
    const newPage = currentSearchResults.page + delta;
    if (newPage >= 1 && newPage <= currentSearchResults.totalPages) {
        searchHotels(newPage);
    }
}

function updateSort(value) {
    searchHotels(1);
}

// Utility functions
function formatAddress(hotel) {
    const address = hotel.hotel.address;
    const parts = [];
    
    if (address) {
        if (address.lines) parts.push(...address.lines);
        if (address.postalCode) parts.push(address.postalCode);
        if (address.cityName) parts.push(address.cityName);
        if (address.countryCode) parts.push(address.countryCode);
    }
    
    return parts.length > 0 ? parts.join(', ') : 'Address not available';
}

function formatPrice(offers) {
    if (!offers || !offers.length || !offers[0].price) {
        return 'Price on request';
    }
    return `€${parseFloat(offers[0].price.total).toFixed(2)}`;
}

// Form submission handler
document.getElementById('hotelSearchForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    searchHotels(1);
});

// Initialize filters change handlers
document.querySelectorAll('#ratingFilters input, #priceRange').forEach(input => {
    input.addEventListener('change', () => searchHotels(1));
});
